import { DatabaseService } from "../services/database.js";

// Define tool type with handler
export interface DbTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (db: DatabaseService, args: any) => Promise<any>;
}
