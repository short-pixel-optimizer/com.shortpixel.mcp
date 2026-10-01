/**
 * Resource-server side: verifies a Bearer token that claims to be an OAuth
 * access token issued by this server's own Authorization Server
 * (src/oauth/provider.ts), and extracts the ShortPixel API key embedded in
 * it at issuance (see provider.ts's extraTokenClaims)
 */

import {
  compactDecrypt,
  createLocalJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWK,
} from "jose";
import { getOauthIssuer } from "../config/environment.js";
import { loadOrCreateJwks } from "./jwks.js";
import { MCP_RESOURCE_IDENTIFIER } from "./resource.js";
import { loadOrCreateTokenEncryptionKey } from "./token-encryption-key.js";

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
const tokenEncryptionKey = loadOrCreateTokenEncryptionKey();

/**
 * A raw ShortPixel API key (CommonsConfig::API_KEY_LENGTH = 20 alnum chars)
 * never contains a dot; a JWT/JWE always does. Anything dotted goes through
 * OAuth verification and is never accepted as a raw key.
 */
export function looksLikeOauthToken(value: string): boolean {
  return value.includes(".");
}

/**
 * Access tokens are nested JWTs: RS256-signed, then JWE-encrypted (dir +
 * A256GCM) - see provider.ts. Only the encrypted form is accepted, so a
 * plain signed token (readable API key) is refused even if its signature
 * is valid.
 */
export async function verifyOauthAccessToken(token: string): Promise<string | undefined> {
  try {
    const { plaintext } = await compactDecrypt(token, tokenEncryptionKey, {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });

    const { payload } = await jwtVerify(new TextDecoder().decode(plaintext), jwks, {
      issuer: getOauthIssuer(),
      audience: MCP_RESOURCE_IDENTIFIER,
    });

    const apiKey = payload.api_key;
    return typeof apiKey === "string" && apiKey.length > 0 ? apiKey : undefined;
  } catch {
    // Forged, expired, or plain-signed tokens all land here; the caller
    // falls back to the X-ShortPixel-Api-Key header, so this isn't an error
    // worth logging.
    return undefined;
  }
}
