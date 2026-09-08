import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import { SpioApiClient } from "../src/clients/spio-api-client.js";

/**
 * SpioApiClient unit tests with mocked fetch
 * Covers payload shape, response normalization, error handling, and retry behavior
 */

const BASE_URL = "https://api.test.shortpixel/v2";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  mock.restoreAll();
});

describe("SpioApiClient constructor", () => {
  it("requires a non-empty API key", () => {
    assert.throws(
      () => new SpioApiClient({ apiKey: "" }),
      /API key is required/,
    );
  });
});

describe("SpioApiClient.optimizeUrls", () => {
  it("rejects empty url lists", async () => {
    const client = new SpioApiClient({ apiKey: "test-key", baseUrl: BASE_URL });

    await assert.rejects(
      () => client.optimizeUrls([]),
      /At least one image URL is required/,
    );
  });

  it("posts reducer payload with defaults merged over options", async () => {
    const fetchMock = mock.fn(async () =>
      jsonResponse([
        {
          Status: { Code: 2, Message: "Success" },
          OriginalURL: "https://8.8.8.8/a.jpg",
          LossyURL: "https://cdn.shortpixel.ai/a.jpg",
        },
      ]),
    );

    mock.method(globalThis, "fetch", fetchMock);

    const client = new SpioApiClient({
      apiKey: "secret-key",
      baseUrl: BASE_URL,
      pluginVersion: "TEST01",
    });

    await client.optimizeUrls(["https://8.8.8.8/a.jpg"], {
      lossy: 0,
      wait: 0,
      upscale: 2,
    });

    assert.equal(fetchMock.mock.calls.length, 1);

    const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(url, `${BASE_URL}/reducer.php`);
    assert.equal(init.method, "POST");

    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    assert.equal(payload.key, "secret-key");
    assert.equal(payload.plugin_version, "TEST01");
    assert.equal(payload.lossy, 0);
    assert.equal(payload.wait, 0);
    assert.deepEqual(payload.urllist, ["https://8.8.8.8/a.jpg"]);
    assert.equal(payload.upscale, 2);
  });

  it("normalizes single-object API responses into an array", async () => {
    mock.method(
      globalThis,
      "fetch",
      mock.fn(async () =>
        jsonResponse({
          Status: { Code: 2, Message: "Success" },
          OriginalURL: "https://8.8.8.8/b.jpg",
          LossyURL: "https://cdn.shortpixel.ai/b.jpg",
        }),
      ),
    );

    const client = new SpioApiClient({ apiKey: "k", baseUrl: BASE_URL });
    const results = await client.optimizeUrls(["https://8.8.8.8/b.jpg"]);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.OriginalURL, "https://8.8.8.8/b.jpg");
  });

  it("normalizes numeric-key indexed responses", async () => {
    mock.method(
      globalThis,
      "fetch",
      mock.fn(async () =>
        jsonResponse({
          "1": {
            Status: { Code: 2 },
            OriginalURL: "https://8.8.8.8/1.jpg",
          },
          "0": {
            Status: { Code: 2 },
            OriginalURL: "https://8.8.8.8/0.jpg",
          },
        }),
      ),
    );

    const client = new SpioApiClient({ apiKey: "k", baseUrl: BASE_URL });
    const results = await client.optimizeUrls([
      "https://8.8.8.8/0.jpg",
      "https://8.8.8.8/1.jpg",
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0]?.OriginalURL, "https://8.8.8.8/0.jpg");
    assert.equal(results[1]?.OriginalURL, "https://8.8.8.8/1.jpg");
  });

  it("throws on API error objects with Message field", async () => {
    mock.method(
      globalThis,
      "fetch",
      mock.fn(async () =>
        jsonResponse({ Message: "Invalid API key" }, 200),
      ),
    );

    const client = new SpioApiClient({ apiKey: "bad", baseUrl: BASE_URL });

    await assert.rejects(
      () => client.optimizeUrls(["https://8.8.8.8/x.jpg"]),
      /Invalid API key/,
    );
  });

  it("throws when response body is not JSON", async () => {
    mock.method(
      globalThis,
      "fetch",
      mock.fn(async () => new Response("not json", { status: 200 })),
    );

    const client = new SpioApiClient({ apiKey: "k", baseUrl: BASE_URL });

    await assert.rejects(
      () => client.optimizeUrls(["https://8.8.8.8/x.jpg"]),
      /invalid JSON/,
    );
  });

  it("throws when fetch fails at network layer", async () => {
    mock.method(
      globalThis,
      "fetch",
      mock.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const client = new SpioApiClient({ apiKey: "k", baseUrl: BASE_URL });

    await assert.rejects(
      () => client.optimizeUrls(["https://8.8.8.8/x.jpg"]),
      /request failed/,
    );
  });

  it("retries pending optimizations (Status Code 1) with fake timers", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const pendingUrl = "https://8.8.8.8/pending.jpg";
    const fetchMock = mock.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { urllist: string[] };
      const isRetry = body.urllist.length === 1 && body.urllist[0] === pendingUrl;

      if (isRetry && fetchMock.mock.calls.length > 1) {
        return jsonResponse([
          {
            Status: { Code: 2, Message: "Success" },
            OriginalURL: pendingUrl,
            LossyURL: "https://cdn.shortpixel.ai/pending.jpg",
          },
        ]);
      }

      return jsonResponse([
        {
          Status: { Code: 1, Message: "Pending" },
          OriginalURL: pendingUrl,
        },
      ]);
    });

    mock.method(globalThis, "fetch", fetchMock);

    const client = new SpioApiClient({ apiKey: "k", baseUrl: BASE_URL });
    const promise = client.optimizeUrls([pendingUrl], { wait: 0 });

    await t.mock.timers.tickAsync(2_000);

    const results = await promise;

    assert.ok(fetchMock.mock.calls.length >= 2);
    assert.equal(results[0]?.OriginalURL, pendingUrl);

    t.mock.timers.disable();
  });
});
