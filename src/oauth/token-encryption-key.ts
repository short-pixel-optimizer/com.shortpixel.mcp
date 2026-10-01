/**
 * Symmetric key (A256GCM, JWE "dir") that encrypts every OAuth access token
 * this server issues. The token carries the user's ShortPixel API key, and
 * a signed-only JWT is readable by anyone holding it - encrypting it means
 * only this server can see the key. Persisted in secrets/ like the signing
 * keys, so issued tokens stay valid across restarts.
 */

import { createSecretKey, randomBytes, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { projectRoot } from "../config/environment.js";

const keyPath = resolve(projectRoot, "secrets", "oauth-token-encryption-key.json");

export function loadOrCreateTokenEncryptionKey(): KeyObject {
  if (existsSync(keyPath)) {
    const { key } = JSON.parse(readFileSync(keyPath, "utf8")) as { key: string };
    return createSecretKey(Buffer.from(key, "base64url"));
  }

  const key = randomBytes(32);

  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, JSON.stringify({ key: key.toString("base64url") }, null, 2), {
    mode: 0o600,
  });

  return createSecretKey(key);
}
