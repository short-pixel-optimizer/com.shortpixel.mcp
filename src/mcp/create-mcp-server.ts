import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SpioApiClient } from "../clients/spio-api-client.js";
import { SpioTools } from "../tools/spio-tools.js";

const SERVER_NAME = "ShortPixel MCP";
const SERVER_VERSION = "0.1.0";

export function createMcpServer(apiKey: string): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const client = new SpioApiClient({ apiKey });
  new SpioTools(client).registerTools(server);

  return server;
}
