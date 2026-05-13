# Steampipe MCP Server (Streamable HTTP)

Fork of [turbot/steampipe-mcp](https://github.com/turbot/steampipe-mcp) with **Streamable HTTP transport** support, enabling remote deployment as an HTTP service.

## What's Different

| Feature | Original | This Fork |
|---------|----------|-----------|
| Transport | stdio only | HTTP (default) + stdio |
| Deployment | Local process | Remote server / Docker |
| Auth | N/A | Bearer token (optional) |
| Health check | N/A | `/health` endpoint |
| Concurrency | Single client | Multi-session |

## Quick Start

### HTTP Mode (Default)

```bash
# Install dependencies
npm install

# Build
npm run build

# Start HTTP server on port 3000
node dist/index.js

# With custom port and auth
MCP_API_KEY=my-secret node dist/index.js --port 8080

# Connect to remote Steampipe
STEAMPIPE_MCP_WORKSPACE_DATABASE="postgresql://user:pass@remote-host:9193/steampipe" node dist/index.js
```

### Stdio Mode (Legacy Compatible)

```bash
node dist/index.js --stdio
```

### Docker

```bash
docker build -t steampipe-mcp .
docker run -p 3000:3000 \
  -e STEAMPIPE_MCP_WORKSPACE_DATABASE="postgresql://user:pass@steampipe-host:9193/steampipe" \
  -e MCP_API_KEY="your-secret-key" \
  steampipe-mcp
```

## Client Configuration

### Streamable HTTP (Recommended)

```json
{
  "mcpServers": {
    "steampipe": {
      "url": "http://your-server:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

### Stdio (Local)

```json
{
  "mcpServers": {
    "steampipe": {
      "command": "node",
      "args": ["dist/index.js", "--stdio"]
    }
  }
}
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp` | MCP message endpoint (Streamable HTTP) |
| GET | `/mcp` | SSE stream for server-initiated messages |
| DELETE | `/mcp` | Session termination |
| GET | `/health` | Health check / status |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `3000` | HTTP server port |
| `MCP_API_KEY` | _(none)_ | Bearer token for auth (disabled if empty) |
| `STEAMPIPE_MCP_WORKSPACE_DATABASE` | `postgresql://steampipe@localhost:9193/steampipe` | Steampipe connection string |
| `STEAMPIPE_MCP_LOG_LEVEL` | `info` | Log verbosity |

## CLI Arguments

```
node dist/index.js [options] [connection-string]

Options:
  --http          Start in HTTP mode (default)
  --stdio         Start in stdio mode
  --port <num>    HTTP port (default: 3000)
  --api-key <key> Bearer token for authentication
```

## Architecture

```
[MCP Client] --HTTPS/SSE--> [This Server (Express)] --PostgreSQL--> [Steampipe]
```

The server acts as a bridge between MCP clients and Steampipe's PostgreSQL interface. Steampipe can be local or remote — just point the connection string at it.

## Tools

- **steampipe_query** — Execute SQL queries against Steampipe (read-only)
- **steampipe_table_list** — List available tables (with optional schema/filter)
- **steampipe_table_show** — Get table column definitions and descriptions
- **steampipe_plugin_list** — List installed Steampipe plugins
- **steampipe_plugin_show** — Get plugin details (version, config)

## Development

```bash
git clone https://github.com/mengchencloud/steampipe-mcp.git
cd steampipe-mcp
npm install
npm run build
npm start
```

## License

[Apache 2.0](LICENSE) — Original work by [Turbot HQ, Inc](https://turbot.com).
