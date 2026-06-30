import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SpioApiClient } from "../clients/spio-api-client.js";

export class SpioTools {
  constructor(private readonly client: SpioApiClient) {}

  registerTools(server: McpServer): void {
    server.tool(
      "spio_optimize_urls",
      "Optimize one or more public image URLs via the ShortPixel SPIO reducer API",
      {
        urls: z.array(z.string().url()).min(1).describe("Public image URLs to optimize"),
        lossy: z.number().int().min(0).max(2).optional().default(1).describe("Compression level: 0=lossless, 1=lossy, 2=glossy"),
        wait: z.number().int().min(0).max(30).optional().default(20).describe("Seconds to wait for optimization"),
        convertTo: z.string().optional().describe("Target format, e.g. webp, avif, png, jpg"),
        resize: z.number().int().min(0).max(5).optional().default(0).describe("Resize mode"),
        resizeWidth: z.number().int().positive().optional().describe("Target width in pixels"),
        resizeHeight: z.number().int().positive().optional().describe("Target height in pixels"),
      },
      async (args) => this.handleOptimizeUrls(args),
    );
  }

  private async handleOptimizeUrls({
    urls,
    lossy,
    wait,
    convertTo,
    resize,
    resizeWidth,
    resizeHeight,
  }: {
    urls: string[];
    lossy: number;
    wait: number;
    convertTo?: string;
    resize: number;
    resizeWidth?: number;
    resizeHeight?: number;
  }) {
    const options: Record<string, number | string> = {
      lossy,
      wait,
      resize,
    };

    if (convertTo) {
      options.convertto = convertTo;
    }

    if (resizeWidth !== undefined) {
      options.resize_width = resizeWidth;
    }

    if (resizeHeight !== undefined) {
      options.resize_height = resizeHeight;
    }

    const results = await this.client.optimizeUrls(urls, options);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              count: results.length,
              results,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
