/**
 * Resource-server side: verifies a Bearer token that claims to be an OAuth
 * access token issued by this server's own Authorization Server
 * (src/oauth/provider.ts), and extracts the ShortPixel API key embedded in
 * it at issuance (see provider.ts's extraTokenClaims)
 */

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWK } from "jose";
import { getOauthIssuer } from "../config/environment.js";
import { loadOrCreateJwks } from "./jwks.js";
import { MCP_RESOURCE_IDENTIFIER } from "./resource.js";

// jose's own signing key file - loadOrCreateJwks() - carries full private
// RSA material (d, p, q, dp, dq, qi) because provider.ts needs it to sign
// tokens. createLocalJWKSet refuses a set containing private keys ("JSON
// Web Key Set members must be public keys", ERR_JWKS_INVALID), so strip
// those fields here for the resource-server's verification-only copy.
const PRIVATE_RSA_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

function toPublicJwks(fullJwks: { keys: JWK[] }): JSONWebKeySet {
  return {
    keys: fullJwks.keys.map((key) => {
      const publicKey = { ...key };

      for (const field of PRIVATE_RSA_FIELDS) {
        delete publicKey[field];
      }

      return publicKey as JWK;
    }),
  };
}

const jwks = createLocalJWKSet(toPublicJwks(loadOrCreateJwks() as { keys: JWK[] }));

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
    // A raw, non-OAuth bearer token that happens to contain two dots would
    // also land here - falling through to try it as a static API key is the
    // correct behavior, not an error worth logging.
    return undefined;
  }
}
