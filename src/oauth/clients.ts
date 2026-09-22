/**
 * Statically trusted OAuth 2.1 clients registered with this server's
 * Authorization Server.
 *
 * Real MCP clients (Claude, ChatGPT, Cursor, Mistral, ...) no longer need an
 * entry here: provider.ts enables Dynamic Client Registration (RFC 7591) and
 * Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document-02),
 * so they register/resolve themselves on first connect. This array is now
 * only for the local test client used to exercise the full flow end-to-end
 * with curl/a manual browser test, without needing a real client to hand.
 *
 * These are public clients (no client_secret): PKCE (S256) is required
 * instead.
 */

import type { ClientMetadata } from "oidc-provider";

export const TRUSTED_CLIENTS: ClientMetadata[] = [
  {
    client_id: "test-client",
    client_name: "Local test client",
    redirect_uris: ["http://localhost:8787/callback", "http://127.0.0.1:8787/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
  },
];
