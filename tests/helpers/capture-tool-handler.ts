import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SpioTools } from "../../src/tools/spio-tools.js";

export type OptimizeToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
}>;

/**
 * Registers SpioTools against a stub MCP server and returns the optimize_image_urls handler
 */
export function captureOptimizeHandler(tools: SpioTools): OptimizeToolHandler {
  let handler: OptimizeToolHandler | undefined;

  const mockServer = {
    registerTool(
      _name: string,
      _config: unknown,
      registeredHandler: OptimizeToolHandler,
    ) {
      handler = registeredHandler;
    },
  } as unknown as McpServer;

  tools.registerTools(mockServer);

  if (!handler) {
    throw new Error("optimize_image_urls handler was not registered");
  }

  return handler;
}
