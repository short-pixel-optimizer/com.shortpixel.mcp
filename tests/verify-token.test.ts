import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompactEncrypt, importJWK, SignJWT, type JWK } from "jose";
import { getOauthIssuer } from "../src/config/environment.js";
import { loadOrCreateJwks } from "../src/oauth/jwks.js";
import { MCP_RESOURCE_IDENTIFIER } from "../src/oauth/resource.js";
import { loadOrCreateTokenEncryptionKey } from "../src/oauth/token-encryption-key.js";
import { looksLikeOauthToken, verifyOauthAccessToken } from "../src/oauth/verify-token.js";

async function signedToken(): Promise<string> {
  const jwk = (loadOrCreateJwks() as { keys: JWK[] }).keys[0];
  return new SignJWT({ api_key: "TESTKEY1234567890abc" })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(getOauthIssuer())
    .setAudience(MCP_RESOURCE_IDENTIFIER)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(await importJWK(jwk, "RS256"));
}

async function encrypt(inner: string): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(inner))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", cty: "at+jwt" })
    .encrypt(loadOrCreateTokenEncryptionKey());
}

describe("verifyOauthAccessToken", () => {
  it("returns the API key from a signed-then-encrypted token", async () => {
    assert.equal(await verifyOauthAccessToken(await encrypt(await signedToken())), "TESTKEY1234567890abc");
  });

  it("rejects a validly signed but unencrypted token", async () => {
    assert.equal(await verifyOauthAccessToken(await signedToken()), undefined);
  });

  it("rejects an encrypted token whose inner JWT isn't signed by us", async () => {
    assert.equal(await verifyOauthAccessToken(await encrypt("forged.oauth.token")), undefined);
  });

  it("rejects garbage", async () => {
    assert.equal(await verifyOauthAccessToken("a.b.c.d.e"), undefined);
  });
});

describe("looksLikeOauthToken", () => {
  it("routes anything dotted through OAuth verification", () => {
    assert.equal(looksLikeOauthToken("a.b.c"), true);
    assert.equal(looksLikeOauthToken("a.b.c.d.e"), true);
  });

  it("treats a dotless value as a raw API key", () => {
    assert.equal(looksLikeOauthToken("TESTKEY1234567890abc"), false);
  });
});
