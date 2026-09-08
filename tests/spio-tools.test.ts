import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { SpioApiClient } from "../src/clients/spio-api-client.js";
import { SpioTools } from "../src/tools/spio-tools.js";
import { captureOptimizeHandler } from "./helpers/capture-tool-handler.js";

const PUBLIC_IMAGE = "https://8.8.8.8/sample.jpg";

function createMockClient() {
  return {
    optimizeUrls: mock.fn(async () => [
      {
        Status: { Code: 2, Message: "Success" },
        OriginalURL: PUBLIC_IMAGE,
        LossyURL: "https://cdn.shortpixel.ai/optimized.jpg",
      },
    ]),
  } as unknown as SpioApiClient;
}

describe("SpioTools — SSRF protection before SPIO call", () => {
  it("rejects loopback image URLs before calling the API client", async () => {
    const client = createMockClient();
    const handler = captureOptimizeHandler(new SpioTools(client));

    await assert.rejects(
      () =>
        handler({
          urls: ["http://127.0.0.1/internal.jpg"],
          lossy: 1,
          wait: 0,
          upscale: 0,
          resize: 0,
          cmyk2rgb: 1,
          keep_exif: 0,
          refresh: 0,
        }),
      /non-public IP/,
    );

    assert.equal((client.optimizeUrls as ReturnType<typeof mock.fn>).mock.calls.length, 0);
  });

  it("rejects private bg_remove background image URLs", async () => {
    const client = createMockClient();
    const handler = captureOptimizeHandler(new SpioTools(client));

    await assert.rejects(
      () =>
        handler({
          urls: [PUBLIC_IMAGE],
          lossy: 1,
          wait: 0,
          upscale: 0,
          resize: 0,
          cmyk2rgb: 1,
          keep_exif: 0,
          refresh: 0,
          bg_remove: "http://192.168.0.10/bg.png",
        }),
      /non-public IP/,
    );

    assert.equal((client.optimizeUrls as ReturnType<typeof mock.fn>).mock.calls.length, 0);
  });

  it("allows bg_remove color token without URL validation", async () => {
    const client = createMockClient();
    const handler = captureOptimizeHandler(new SpioTools(client));

    const result = await handler({
      urls: [PUBLIC_IMAGE],
      lossy: 1,
      wait: 0,
      upscale: 0,
      resize: 0,
      cmyk2rgb: 1,
      keep_exif: 0,
      refresh: 0,
      bg_remove: "#ff00ff80",
    });

    assert.equal((client.optimizeUrls as ReturnType<typeof mock.fn>).mock.calls.length, 1);
    const options = (client.optimizeUrls as ReturnType<typeof mock.fn>).mock.calls[0]
      .arguments[1] as Record<string, unknown>;
    assert.equal(options.bg_remove, "#ff00ff80");
    assert.ok(result.content[0]?.text.includes("optimized.jpg"));
  });

  it("allows numeric bg_remove flag (transparent background)", async () => {
    const client = createMockClient();
    const handler = captureOptimizeHandler(new SpioTools(client));

    await handler({
      urls: [PUBLIC_IMAGE],
      lossy: 1,
      wait: 0,
      upscale: 0,
      resize: 0,
      cmyk2rgb: 1,
      keep_exif: 0,
      refresh: 0,
      bg_remove: 1,
    });

    const options = (client.optimizeUrls as ReturnType<typeof mock.fn>).mock.calls[0]
      .arguments[1] as Record<string, unknown>;
    assert.equal(options.bg_remove, 1);
  });

  it("rejects per-URL bg_remove in paramlist", async () => {
    const client = createMockClient();
    const handler = captureOptimizeHandler(new SpioTools(client));

    await assert.rejects(
      () =>
        handler({
          urls: [PUBLIC_IMAGE],
          lossy: 1,
          wait: 0,
          upscale: 0,
          resize: 0,
          cmyk2rgb: 1,
          keep_exif: 0,
          refresh: 0,
          paramlist: [{ bg_remove: "http://10.0.0.5/background.jpg" }],
        }),
      /non-public IP/,
    );
  });

  it("rejects paramlist length mismatch before security checks", async () => {
    const client = createMockClient();
    const handler = captureOptimizeHandler(new SpioTools(client));

    await assert.rejects(
      () =>
        handler({
          urls: [PUBLIC_IMAGE, PUBLIC_IMAGE],
          lossy: 1,
          wait: 0,
          upscale: 0,
          resize: 0,
          cmyk2rgb: 1,
          keep_exif: 0,
          refresh: 0,
          paramlist: [{ lossy: 0 }],
        }),
      /paramlist must have the same number of entries/,
    );
  });

  it("forwards valid public URLs and options to SpioApiClient", async () => {
    const client = createMockClient();
    const handler = captureOptimizeHandler(new SpioTools(client));

    await handler({
      urls: [PUBLIC_IMAGE],
      lossy: 2,
      wait: 5,
      upscale: 2,
      resize: 1,
      resize_width: 800,
      resize_height: 600,
      cmyk2rgb: 0,
      keep_exif: 1,
      convertto: "+webp",
      refresh: 1,
      returndatalist: ["correlation-id"],
    });

    assert.equal((client.optimizeUrls as ReturnType<typeof mock.fn>).mock.calls.length, 1);

    const [urls, options] = (client.optimizeUrls as ReturnType<typeof mock.fn>).mock.calls[0]
      .arguments as [string[], Record<string, unknown>];

    assert.deepEqual(urls, [PUBLIC_IMAGE]);
    assert.equal(options.lossy, 2);
    assert.equal(options.wait, 5);
    assert.equal(options.upscale, 2);
    assert.equal(options.resize, 1);
    assert.equal(options.resize_width, 800);
    assert.equal(options.resize_height, 600);
    assert.equal(options.cmyk2rgb, 0);
    assert.equal(options.keep_exif, 1);
    assert.equal(options.convertto, "+webp");
    assert.equal(options.refresh, 1);
    assert.deepEqual(options.returndatalist, ["correlation-id"]);
  });
});
