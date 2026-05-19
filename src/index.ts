#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DatabaseService } from "./services/database.js";
import { configureTypeParser } from "./services/database-config.js";
import { setupTools } from "./tools/index.js";
import { setupPromptHandlers, promptCapabilities } from "./prompts/index.js";
import { setupResourceHandlers, resourceCapabilities } from "./resources/index.js";
import { setupResourceTemplateHandlers } from "./resourceTemplates/index.js";
import { logger } from "./services/logger.js";
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import cors from 'cors';

// Load package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

// Server metadata
const SERVER_INFO = {
  name: "steampipe",
  version: pkg.version,
  description: pkg.description,
  vendor: pkg.author,
  license: pkg.license,
  homepage: pkg.homepage,
} as const;

let serverStartTime: Date;

// Prevent process crash on unhandled PG connection errors.
// When Steampipe's backend drops idle connections, the pg Client
// emits an 'error' event that may not be caught by the pool handler.
// Without these, the process exits with "Connection terminated unexpectedly".
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception (process kept alive):', err.message);
  // Let the pool's own error handler reset state; don't exit.
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection (process kept alive):', reason);
});

// Handle graceful shutdown
function setupShutdownHandlers(db: DatabaseService) {
  const gracefulShutdown = async () => {
    if (db) {
      try {
        await db.close();
      } catch (error) {
        process.exit(1);
      }
    }
    process.exit(0);
  };
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

export function getServerStartTime(): Date {
  return serverStartTime;
}

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let transport: 'stdio' | 'http' = 'http'; // default to http
  let port = parseInt(process.env.MCP_PORT || '3000', 10);
  let connectionString: string | undefined;
  let apiKey: string | undefined = process.env.MCP_API_KEY;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stdio') {
      transport = 'stdio';
    } else if (arg === '--http') {
      transport = 'http';
    } else if (arg === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (arg === '--api-key' && args[i + 1]) {
      apiKey = args[++i];
    } else if (!arg.startsWith('--')) {
      // Legacy: treat positional arg as connection string
      connectionString = arg;
    }
  }

  return { transport, port, connectionString, apiKey };
}

// Simple Bearer token auth middleware
function authMiddleware(apiKey: string | undefined) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!apiKey) {
      // No API key configured, skip auth
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Missing or invalid Bearer token' });
      return;
    }

    const token = authHeader.slice(7);
    if (token !== apiKey) {
      res.status(403).json({ error: 'Forbidden: Invalid API key' });
      return;
    }

    next();
  };
}

function createMCPServer(db: DatabaseService): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: {
      tools: {},
      prompts: promptCapabilities.prompts,
      resources: resourceCapabilities.resources
    },
  });

  setupTools(server, db);
  setupPromptHandlers(server);
  setupResourceHandlers(server, db);
  setupResourceTemplateHandlers(server);

  return server;
}

async function startHttpServer(port: number, db: DatabaseService, apiKey: string | undefined) {
  const app = express();

  app.use(cors());
  // Do NOT use express.json() globally — the MCP transport (StreamableHTTPServerTransport)
  // uses its own body-parser internally. Global express.json() consumes the request body
  // stream, causing the transport to read an empty body (JSON-RPC parse error).

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      uptime: Math.floor((Date.now() - serverStartTime.getTime()) / 1000),
      database: db.isConnected ? 'connected' : 'disconnected'
    });
  });

  // Apply auth middleware to MCP endpoints
  app.use('/mcp', authMiddleware(apiKey));

  // Store active transports by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // MCP Streamable HTTP endpoint - POST (messages)
  app.post('/mcp', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      // If we have a session ID, try to reuse existing transport
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }

      // Create new transport for new session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport);
          logger.info(`New MCP session created: ${newSessionId}`);
        }
      });

      // Clean up on close
      transport.onclose = () => {
        const sid = [...transports.entries()].find(([_, t]) => t === transport)?.[0];
        if (sid) {
          transports.delete(sid);
          logger.info(`MCP session closed: ${sid}`);
        }
      };

      // Create a new MCP server for this session
      const server = createMCPServer(db);
      await server.connect(transport);

      // Handle the initial request
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // MCP Streamable HTTP endpoint - GET (SSE stream for server-initiated messages)
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // MCP Streamable HTTP endpoint - DELETE (session termination)
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
    logger.info(`MCP session terminated: ${sessionId}`);
  });

  app.listen(port, () => {
    logger.info(`Steampipe MCP HTTP server listening on port ${port}`);
    logger.info(`  MCP endpoint: http://localhost:${port}/mcp`);
    logger.info(`  Health check: http://localhost:${port}/health`);
    if (apiKey) {
      logger.info(`  Auth: Bearer token required`);
    } else {
      logger.info(`  Auth: DISABLED (set MCP_API_KEY to enable)`);
    }
  });
}

async function startStdioServer(db: DatabaseService) {
  const server = createMCPServer(db);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Steampipe MCP server running on stdio');
}

export async function startServer() {
  serverStartTime = new Date();
  const { transport, port, connectionString, apiKey } = parseArgs();

  logger.info(`Starting server in ${transport} mode`);

  try {
    // Configure global type parsers
    configureTypeParser();

    // Get database service instance
    const db = DatabaseService.getInstance();

    // Set connection string if provided
    if (connectionString) {
      db.setConfig({ connectionString });
      logger.info('Using connection string from command line argument');
    }

    // Set up shutdown handlers
    setupShutdownHandlers(db);

    // Start in the appropriate mode
    if (transport === 'http') {
      await startHttpServer(port, db, apiKey);
    } else {
      await startStdioServer(db);
    }
  } catch (error) {
    logger.error('Failed to start server:', error);
    throw error;
  }
}

// Start the server
startServer();
