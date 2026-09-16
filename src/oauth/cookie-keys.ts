/**
 * Signing/encryption keys for oidc-provider's own session and interaction
 * cookies. Persisted the same way as the JWT signing keys (secrets/), so a
 * restart doesn't drop every in-flight authorization the moment it happens
 * to land between /interaction and the PHP callback.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { projectRoot } from "../config/environment.js";

const cookieKeysPath = resolve(projectRoot, "secrets", "oauth-cookie-keys.json");

export function loadOrCreateCookieKeys(): string[] {
  if (existsSync(cookieKeysPath)) {
    return JSON.parse(readFileSync(cookieKeysPath, "utf8"));
  }

  const keys = [randomBytes(32).toString("hex")];

  mkdirSync(dirname(cookieKeysPath), { recursive: true });
  writeFileSync(cookieKeysPath, JSON.stringify(keys, null, 2), { mode: 0o600 });

  return keys;
}
