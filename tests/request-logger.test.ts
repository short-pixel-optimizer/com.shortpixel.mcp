import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskApiKey, sanitizeHttpHeaders } from "../src/logging/request-logger.js";

describe("maskApiKey", () => {
  it("masks short keys completely", () => {
    assert.equal(maskApiKey("abc"), "****");
    assert.equal(maskApiKey("abcd"), "****");
  });

  it("keeps only the last four characters visible", () => {
    assert.equal(maskApiKey("sk_live_abcdefgh"), "****efgh");
  });
});

describe("sanitizeHttpHeaders", () => {
  it("returns empty object for invalid header input", () => {
    assert.deepEqual(sanitizeHttpHeaders(null), {});
    assert.deepEqual(sanitizeHttpHeaders("headers"), {});
  });

  it("redacts Authorization Bearer tokens using maskApiKey", () => {
    const sanitized = sanitizeHttpHeaders({
      Authorization: "Bearer super_secret_api_key_1234",
    });

    assert.equal(sanitized.Authorization, "Bearer ****1234");
  });

  it("redacts X-ShortPixel-Api-Key header", () => {
    const sanitized = sanitizeHttpHeaders({
      "X-ShortPixel-Api-Key": "my_shortpixel_key_9999",
    });

    assert.equal(sanitized["X-ShortPixel-Api-Key"], "****9999");
  });

  it("redacts cookie header entirely", () => {
    const sanitized = sanitizeHttpHeaders({
      cookie: "session=abc123",
    });

    assert.equal(sanitized.cookie, "****");
  });

  it("passes through non-sensitive headers unchanged", () => {
    const sanitized = sanitizeHttpHeaders({
      "content-type": "application/json",
      "user-agent": "test-runner",
    });

    assert.deepEqual(sanitized, {
      "content-type": "application/json",
      "user-agent": "test-runner",
    });
  });

  it("joins array header values", () => {
    const sanitized = sanitizeHttpHeaders({
      accept: ["application/json", "text/plain"],
    });

    assert.equal(sanitized.accept, "application/json, text/plain");
  });
});
