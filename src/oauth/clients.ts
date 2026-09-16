/**
 * Trusted OAuth 2.1 clients registered with this server's Authorization Server.
 *
 * These are public clients (no client_secret): PKCE (S256) is required for
 * all of them instead. Real clients (Claude, ChatGPT) are added here once
 * their exact redirect_uris are confirmed; until then a local test client
 * lets the full flow be exercised end-to-end with curl/a manual browser test.
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

  // Claude web (claude.ai custom connector) - redirect_uri per Anthropic's
  // MCP connector docs. Loopback entries cover Claude Code / Cursor, where
  // the port varies per launch and is ignored during matching.
  // {
  //   client_id: "claude",
  //   client_name: "Claude",
  //   redirect_uris: [
  //     "https://claude.ai/api/mcp/auth_callback",
  //     "http://localhost/callback",
  //     "http://127.0.0.1/callback",
  //   ],
  //   grant_types: ["authorization_code", "refresh_token"],
  //   response_types: ["code"],
  //   token_endpoint_auth_method: "none",
  //   application_type: "native",
  // },

  // ChatGPT - redirect_uri TBD, confirm exact value from OpenAI's Apps SDK
  // docs before enabling.
  // {
  //   client_id: "chatgpt",
  //   client_name: "ChatGPT",
  //   redirect_uris: [],
  //   grant_types: ["authorization_code", "refresh_token"],
  //   response_types: ["code"],
  //   token_endpoint_auth_method: "none",
  //   application_type: "web",
  // },
];
