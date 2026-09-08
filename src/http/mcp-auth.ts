/**
 * MCP JSON-RPC auth policy helpers
 * initialize and tools/list are allowed without an API key for discovery
 */

export function readMcpMethod(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const payload = body as Record<string, unknown>;
  return typeof payload.method === "string" ? payload.method : undefined;
}

export function isAuthRequiredForMcpMethod(method: string | undefined): boolean {
  return method !== "initialize" && method !== "tools/list";
}
