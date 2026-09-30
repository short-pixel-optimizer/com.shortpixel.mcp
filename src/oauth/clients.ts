/**
 * OAuth 2.1 clients configured statically, by client_id.
 *
 * Only the local test client lives here. Real MCP clients (Claude, ChatGPT,
 * Cursor, Mistral, ...) can't be listed by client_id: they get one from
 * Dynamic Client Registration (a random id we hand out) or bring their own
 * via a Client ID Metadata Document (a URL they own) - see provider.ts.
 *
 * Registration is open, so ANYONE can register a client, a malicious one
 * included, and give it any name. Registering grants nothing by itself:
 * access still needs a human to approve it on com.shortpixel.www's consent
 * screen, and trust is shown there only via VERIFIED_CLIENT_REDIRECT_HOSTS
 * below (green badge), never via the self-declared name.
 *
 * All clients are public (no client_secret): PKCE (S256) is required
 * instead.
 */

import type { ClientMetadata } from "oidc-provider";

export const TRUSTED_CLIENTS: ClientMetadata[] = [
  {
    client_id: "test-client",
    client_name: "TEST",
    redirect_uris: ["http://localhost:8787/callback", "http://127.0.0.1:8787/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
  },
];

// Hosts of redirect_uris belonging to AI clients we know. A client can
// declare any client_name it likes via DCR, but it can only receive the
// authorization code at a redirect_uri it actually controls - so the
// redirect host, not the name, is what the consent screen's "verified"
// badge is based on. Exact hostname match only: some of these parent
// domains (e.g. googleusercontent.com) also host arbitrary user content.
// Loopback redirects (Cursor, Claude Code, Gemini CLI) can never be
// verified this way, since any local program can listen on localhost.
const VERIFIED_CLIENT_REDIRECT_HOSTS = new Set([
  "claude.ai",
  "chatgpt.com",
  "oauth-redirect.googleusercontent.com",
  "vertexaisearch.cloud.google.com",
  "grok.com",
]);

export function isVerifiedClientRedirect(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" && VERIFIED_CLIENT_REDIRECT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
