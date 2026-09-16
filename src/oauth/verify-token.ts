/**
 * Resource-server side: verifies a Bearer token that claims to be an OAuth
 * access token issued by this server's own Authorization Server
 * (src/oauth/provider.ts), and extracts the ShortPixel API key embedded in
 * it at issuance (see provider.ts's extraTokenClaims)
 */

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { getOauthIssuer } from "../config/environment.js";
import { loadOrCreateJwks } from "./jwks.js";
import { MCP_RESOURCE_IDENTIFIER } from "./resource.js";

const jwks = createLocalJWKSet(loadOrCreateJwks() as JSONWebKeySet);

/**
 * A raw ShortPixel API key (CommonsConfig::API_KEY_LENGTH = 20 alnum chars)
 * never contains a dot; a JWT always has exactly two. Cheap enough to check
 * before attempting real signature verification.
 */
export function looksLikeJwt(value: string): boolean {
  return value.split(".").length === 3;
}

export async function verifyOauthAccessToken(token: string): Promise<string | undefined> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: getOauthIssuer(),
      audience: MCP_RESOURCE_IDENTIFIER,
    });

    const apiKey = payload.api_key;
    return typeof apiKey === "string" && apiKey.length > 0 ? apiKey : undefined;
  } catch {
    return undefined;
  }
}
