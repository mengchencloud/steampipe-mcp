import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListResourceTemplatesRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../services/logger.js";

// Register all available resource templates
const resourceTemplates: Array<{ uriTemplate: string; name: string; description: string }> = [];

// Export resource templates for server capabilities
export const resourceTemplateCapabilities = {
  resourceTemplates: {}
};

export function setupResourceTemplateHandlers(server: Server) {
  // Register resource template list handler
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    try {
      return { resourceTemplates };
    } catch (error) {
      // Log the error but don't fail - return default templates
      if (error instanceof Error) {
        logger.error("Critical error listing resource templates:", error.message);
      } else {
        logger.error("Critical error listing resource templates:", error);
      }
      
      // Return empty list on error
      return { resourceTemplates: [] };
    }
  });
} 