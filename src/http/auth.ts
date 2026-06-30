import type { Request } from "express";

export function extractApiKey(request: Request): string | undefined {
  const authorization = request.headers.authorization;

  if (authorization?.startsWith("Bearer ")) {
    const apiKey = authorization.slice(7).trim();

    if (apiKey) {
      return apiKey;
    }
  }

  const headerValue = request.headers["x-shortpixel-api-key"];

  if (typeof headerValue === "string") {
    const apiKey = headerValue.trim();

    if (apiKey) {
      return apiKey;
    }
  }

  return undefined;
}
