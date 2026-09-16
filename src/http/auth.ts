import type { Request } from "express";
import { looksLikeJwt, verifyOauthAccessToken } from "../oauth/verify-token.js";

/**
 * Extracts the ShortPixel API key to use for this request. The bearer token
 * is either the user's raw, static API key (unchanged, original behavior -
 * still the only option for Cursor/Claude Code/CLI) or a JWT OAuth access
 * token issued by this server's own Authorization Server (src/oauth), with
 * the API key embedded as a claim at issuance.
 */
export async function extractApiKey(request: Request): Promise<string | undefined> {
  const authorization = request.headers.authorization;

  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();

    if (token) {
      if (looksLikeJwt(token)) {
        const apiKey = await verifyOauthAccessToken(token);

        if (apiKey) {
          return apiKey;
        }
      } else {
        return token;
      }
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
