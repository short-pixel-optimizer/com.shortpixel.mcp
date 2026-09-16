import { existsSync, readFileSync } from "node:fs";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

config({ path: resolve(projectRoot, ".env") });

export function get(name: string, defaultValue?: string): string | undefined {
  const value = process.env[name];

  if (!value) {
    return defaultValue;
  }

  return value;
}

export function getNumber(name: string, defaultValue: number): number {
  const value = process.env[name];

  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

export function getAllowedHosts(): string[] {
  const value = get("ALLOWED_HOSTS");

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

export function getSpioApiUrl(): string {
  return get("SHORTPIXEL_API_URL", "https://api.shortpixel.com/v2")!;
}

export function getPluginVersion(): string {
  return get("SHORTPIXEL_PLUGIN_VERSION", "MCP01")!;
}

export function getOauthWwwAuthorizeUrl(): string {
  return get("OAUTH_WWW_AUTHORIZE_URL", "https://shortpixel.com/oauth/authorize")!;
}

export function getOauthWwwExchangeUrl(): string {
  return get("OAUTH_WWW_EXCHANGE_URL", "https://shortpixel.com/internal/oauth/exchange-code")!;
}

export function getOauthInternalSecret(): string | undefined {
  return get("OAUTH_INTERNAL_SECRET");
}

export function getOauthIssuer(): string {
  return get("OAUTH_ISSUER", "https://mcp.shortpixel.com")!;
}

export function getOauthResourceIdentifier(): string {
  return get("OAUTH_RESOURCE_IDENTIFIER", "https://mcp.shortpixel.com/mcp")!;
}

export function getMcpRegistryAuthRecord(): string | undefined {
  const fromEnv = get("MCP_REGISTRY_AUTH")?.trim();

  if (fromEnv) {
    return fromEnv;
  }

  const filePath = resolve(projectRoot, "mcp-registry-auth");

  if (!existsSync(filePath)) {
    return undefined;
  }

  const fromFile = readFileSync(filePath, "utf8").trim();
  return fromFile.length > 0 ? fromFile : undefined;
}
