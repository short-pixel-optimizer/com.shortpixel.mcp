import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SpioApiClient } from "../clients/spio-api-client.js";

const paramListItemSchema = z
  .object({
    lossy: z.number().int().min(0).max(2).optional(),
    wait: z.number().int().min(0).max(30).optional(),
    upscale: z.union([z.literal(0), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    resize: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(4)]).optional(),
    resize_width: z.number().int().positive().optional(),
    resize_height: z.number().int().positive().optional(),
    cmyk2rgb: z.union([z.literal(0), z.literal(1)]).optional(),
    keep_exif: z.union([z.literal(0), z.literal(1)]).optional(),
    convertto: z.string().min(1).optional(),
    bg_remove: z
      .union([
        z.literal(1),
        z.string().url(),
        z.string().regex(/^#[0-9a-fA-F]{8}$/),
      ])
      .optional(),
    refresh: z.union([z.literal(0), z.literal(1)]).optional(),
  })
  .strict();

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
        upscale: z
          .union([z.literal(0), z.literal(2), z.literal(3), z.literal(4)])
          .optional()
          .default(0)
          .describe("Upscale factor: 0=off, 2=2x, 3=3x, 4=4x"),
        resize: z
          .union([z.literal(0), z.literal(1), z.literal(3), z.literal(4)])
          .optional()
          .default(0)
          .describe("Resize mode: 0=none, 1=outer, 3=inner, 4=smart crop"),
        resize_width: z.number().int().positive().optional().describe("Target width in pixels"),
        resize_height: z.number().int().positive().optional().describe("Target height in pixels"),
        cmyk2rgb: z
          .union([z.literal(0), z.literal(1)])
          .optional()
          .default(1)
          .describe("Convert CMYK images to RGB: 1=yes, 0=no"),
        keep_exif: z
          .union([z.literal(0), z.literal(1)])
          .optional()
          .default(0)
          .describe("Preserve EXIF metadata: 1=keep, 0=remove"),
        convertto: z
          .string()
          .min(1)
          .optional()
          .describe("Format conversion value, e.g. +webp, +avif, +webp|+avif, webp|avif, jpg, png, gif"),
        bg_remove: z
          .union([
            z.literal(1),
            z.string().url(),
            z.string().regex(/^#[0-9a-fA-F]{8}$/),
          ])
          .optional()
          .describe("Background removal: 1=transparent, URL=background image, #rrggbbxx=color+alpha"),
        refresh: z
          .union([z.literal(0), z.literal(1)])
          .optional()
          .default(0)
          .describe("Re-fetch source before optimization: 1=yes, 0=use cached if available"),
        paramlist: z
          .array(paramListItemSchema)
          .max(100)
          .optional()
          .describe("Per-URL parameter overrides; list length must match urls length"),
        returndatalist: z
          .array(z.unknown())
          .optional()
          .describe("Any array echoed back unchanged in API response"),
      },
      async (args) => this.handleOptimizeUrls(args),
    );
  }

  private async handleOptimizeUrls({
    urls,
    lossy,
    wait,
    upscale,
    convertto,
    resize,
    resize_width,
    resize_height,
    cmyk2rgb,
    keep_exif,
    bg_remove,
    refresh,
    paramlist,
    returndatalist,
  }: {
    urls: string[];
    lossy: number;
    wait: number;
    upscale: 0 | 2 | 3 | 4;
    convertto?: string;
    resize: 0 | 1 | 3 | 4;
    resize_width?: number;
    resize_height?: number;
    cmyk2rgb: 0 | 1;
    keep_exif: 0 | 1;
    bg_remove?: 1 | string;
    refresh: 0 | 1;
    paramlist?: Array<{
      lossy?: number;
      wait?: number;
      upscale?: 0 | 2 | 3 | 4;
      resize?: 0 | 1 | 3 | 4;
      resize_width?: number;
      resize_height?: number;
      cmyk2rgb?: 0 | 1;
      keep_exif?: 0 | 1;
      convertto?: string;
      bg_remove?: 1 | string;
      refresh?: 0 | 1;
    }>;
    returndatalist?: unknown[];
  }) {
    if (paramlist && paramlist.length !== urls.length) {
      throw new Error("paramlist must have the same number of entries as urls");
    }

    const options: Record<string, unknown> = {
      lossy,
      wait,
      upscale,
      resize,
      cmyk2rgb,
      keep_exif,
      refresh,
    };

    if (convertto) {
      options.convertto = convertto;
    }

    if (resize_width !== undefined) {
      options.resize_width = resize_width;
    }

    if (resize_height !== undefined) {
      options.resize_height = resize_height;
    }

    if (bg_remove !== undefined) {
      options.bg_remove = bg_remove;
    }

    if (paramlist !== undefined) {
      options.paramlist = paramlist;
    }

    if (returndatalist !== undefined) {
      options.returndatalist = returndatalist;
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
