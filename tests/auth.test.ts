import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractApiKey } from "../src/http/auth.js";
import type { Request } from "express";

/**
 * Build a minimal Express Request stub with only the headers we need
 */
function makeRequest(headers: Record<string, string | string[] | undefined>): Request {
  return { headers } as Request;
}

describe("extractApiKey", () => {
  it("returns the token from Authorization Bearer header", async () => {
    const key = await extractApiKey(
      makeRequest({ authorization: "Bearer sk_test_abc123" }),
    );

    assert.equal(key, "sk_test_abc123");
  });

  it("trims whitespace around Bearer token", async () => {
    const key = await extractApiKey(
      makeRequest({ authorization: "Bearer   sk_trimmed   " }),
    );

    assert.equal(key, "sk_trimmed");
  });

  it("prefers Bearer over X-ShortPixel-Api-Key when both are present", async () => {
    const key = await extractApiKey(
      makeRequest({
        authorization: "Bearer from_bearer",
        "x-shortpixel-api-key": "from_header",
      }),
    );

    assert.equal(key, "from_bearer");
  });

  it("falls back to X-ShortPixel-Api-Key when Bearer is missing", async () => {
    const key = await extractApiKey(
      makeRequest({ "x-shortpixel-api-key": "header_key_xyz" }),
    );

    assert.equal(key, "header_key_xyz");
  });

  it("trims X-ShortPixel-Api-Key value", async () => {
    const key = await extractApiKey(
      makeRequest({ "x-shortpixel-api-key": "  padded_key  " }),
    );

    assert.equal(key, "padded_key");
  });

  it("returns undefined when Authorization is not Bearer scheme", async () => {
    const key = await extractApiKey(
      makeRequest({ authorization: "Basic dXNlcjpwYXNz" }),
    );

    assert.equal(key, undefined);
  });

  it("returns undefined for empty Bearer token", async () => {
    const key = await extractApiKey(makeRequest({ authorization: "Bearer    " }));
    assert.equal(key, undefined);
  });

  it("returns undefined for empty custom header", async () => {
    const key = await extractApiKey(makeRequest({ "x-shortpixel-api-key": "   " }));
    assert.equal(key, undefined);
  });

  it("returns undefined when no auth headers are sent", async () => {
    const key = await extractApiKey(makeRequest({}));
    assert.equal(key, undefined);
  });

  it("ignores array header values for X-ShortPixel-Api-Key", async () => {
    // Express can surface duplicate headers as string[]
    const key = await extractApiKey(
      makeRequest({ "x-shortpixel-api-key": ["first", "second"] }),
    );

    assert.equal(key, undefined);
  });

  it("falls back past an invalid/forged OAuth-shaped Bearer token instead of accepting it as a raw key", async () => {
    // Three dot-separated segments look like a JWT, so it's routed through
    // OAuth verification - it must NOT be accepted as-is (that would let
    // anyone mint a fake "API key" just by including two dots).
    const key = await extractApiKey(
      makeRequest({ authorization: "Bearer not.a.validjwt" }),
    );

    assert.equal(key, undefined);
  });

  it("falls back to X-ShortPixel-Api-Key when the Bearer token is JWT-shaped but invalid", async () => {
    const key = await extractApiKey(
      makeRequest({
        authorization: "Bearer forged.oauth.token",
        "x-shortpixel-api-key": "fallback_key",
      }),
    );

    assert.equal(key, "fallback_key");
  });
});
