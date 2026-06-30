import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
