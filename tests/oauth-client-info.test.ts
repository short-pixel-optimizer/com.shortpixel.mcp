import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { isVerifiedClientRedirect } from "../src/oauth/clients.js";
import { signClientInfo } from "../src/oauth/www-bridge.js";

describe("isVerifiedClientRedirect", () => {
  it("accepts known https client redirect hosts", () => {
    assert.equal(isVerifiedClientRedirect("https://claude.ai/api/mcp/auth_callback"), true);
    assert.equal(isVerifiedClientRedirect("https://chatgpt.com/connector_platform_oauth_redirect"), true);
  });

  it("rejects loopback redirects", () => {
    assert.equal(isVerifiedClientRedirect("http://localhost:8787/callback"), false);
    assert.equal(isVerifiedClientRedirect("http://127.0.0.1/callback"), false);
  });

  it("rejects lookalike, sub- and parent domains", () => {
    assert.equal(isVerifiedClientRedirect("https://claude.ai.evil.com/cb"), false);
    assert.equal(isVerifiedClientRedirect("https://evil.claude.ai/cb"), false);
    assert.equal(isVerifiedClientRedirect("https://googleusercontent.com/cb"), false);
  });

  it("rejects a known host over plain http", () => {
    assert.equal(isVerifiedClientRedirect("http://claude.ai/api/mcp/auth_callback"), false);
  });

  it("rejects malformed URLs", () => {
    assert.equal(isVerifiedClientRedirect("not a url"), false);
    assert.equal(isVerifiedClientRedirect(""), false);
  });
});

describe("signClientInfo", () => {
  const info = {
    client_id: "abc",
    client_name: "Claude \"quoted\" <b>",
    client_domain: "claude.ai",
    verified: true,
    state: "uid-1",
  };

  it("round-trips the payload through base64url JSON", () => {
    const { clientInfo } = signClientInfo("secret", info);
    assert.deepEqual(JSON.parse(Buffer.from(clientInfo, "base64url").toString("utf8")), info);
  });

  it("signs the exact encoded string with HMAC-SHA256 hex, as PHP verifies it", () => {
    const { clientInfo, signature } = signClientInfo("secret", info);
    assert.equal(signature, createHmac("sha256", "secret").update(clientInfo).digest("hex"));
  });

  it("produces a different signature for a different secret", () => {
    assert.notEqual(signClientInfo("a", info).signature, signClientInfo("b", info).signature);
  });
});
