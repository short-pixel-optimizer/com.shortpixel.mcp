/**
 * Signing keys for this server's Authorization Server (JWT access tokens,
 * ID tokens). Generated once and persisted to disk so previously issued
 * tokens stay verifiable across restarts - regenerating on every boot would
 * silently invalidate every outstanding access/refresh token.
 *
 * The private key never leaves this file; it's gitignored, same as
 * environment-specific secrets elsewhere in this project.
 */

import { generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { projectRoot } from "../config/environment.js";

interface SigningJwk extends JsonWebKey {
  kid: string;
  alg: string;
  use: string;
}

const jwksPath = resolve(projectRoot, "secrets", "oauth-jwks.json");

function createJwks(): { keys: SigningJwk[] } {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = privateKey.export({ format: "jwk" }) as JsonWebKey;

  const signingJwk: SigningJwk = {
    ...jwk,
    kid: "oauth-signing-key-1",
    alg: "RS256",
    use: "sig",
  };

  return { keys: [signingJwk] };
}

export function loadOrCreateJwks(): { keys: SigningJwk[] } {
  if (existsSync(jwksPath)) {
    return JSON.parse(readFileSync(jwksPath, "utf8"));
  }

  const jwks = createJwks();

  mkdirSync(dirname(jwksPath), { recursive: true });
  writeFileSync(jwksPath, JSON.stringify(jwks, null, 2), { mode: 0o600 });

  return jwks;
}
