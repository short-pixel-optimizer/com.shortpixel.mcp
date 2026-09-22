/**
 * OAuth 2.1 Authorization Server for mcp.shortpixel.com, built on
 * oidc-provider. This server owns the actual OAuth protocol mechanics
 * (client/redirect_uri trust, PKCE, code/token issuance) end to end -
 * com.shortpixel.www is only ever consulted, via the /interaction bridge, to
 * authenticate a human and hand back which ShortPixel account approved.
 */

import Provider from "oidc-provider";
import { getOauthIssuer } from "../config/environment.js";
import { getAccount } from "./account-store.js";
import { TRUSTED_CLIENTS } from "./clients.js";
import { loadOrCreateCookieKeys } from "./cookie-keys.js";
import { loadOrCreateJwks } from "./jwks.js";
import { MCP_RESOURCE_IDENTIFIER, MCP_SCOPE } from "./resource.js";

export function createOauthProvider(): Provider {
  const provider = new Provider(getOauthIssuer(), {
    clients: TRUSTED_CLIENTS,
    jwks: loadOrCreateJwks(),

    cookies: {
      keys: loadOrCreateCookieKeys(),
      // oidc-provider scopes the _interaction cookie's path to wherever
      // interactions.url() points (/interaction/:uid below) by default, so
      // it's absent by the time the browser reaches /oauth/www-callback -
      // a different path - breaking the second interactionDetails() call
      // there (and interactionFinished()'s own internal one). Root path
      // makes it available everywhere on this domain instead.
      short: { httpOnly: true, sameSite: "lax", path: "/" },
    },

    pkce: {
      required: () => true,
    },

    features: {
      // We supply our own interaction UI (bridged through
      // com.shortpixel.www's login/consent screen) instead of
      // oidc-provider's built-in dev-only pages.
      devInteractions: { enabled: false },
      revocation: { enabled: true },

      // JWT access tokens for our one resource (/mcp), so the resource
      // server (this same process) can verify them locally via this
      // provider's own JWKS, with no extra network round trip per
      // tools/call. defaultResource means clients don't have to pass
      // `resource=` explicitly - there's only ever this one to ask for.
      resourceIndicators: {
        enabled: true,
        defaultResource: () => MCP_RESOURCE_IDENTIFIER,
        getResourceServerInfo: () => ({
          scope: MCP_SCOPE,
          accessTokenFormat: "jwt",
        }),
      },

      // RFC 7591 Dynamic Client Registration - lets real MCP clients
      // (ChatGPT, Cursor, Mistral, ...) register themselves on first
      // connect instead of us hand-maintaining their client_id/redirect_uri
      // in clients.ts. Registration only creates client *metadata* - the
      // actual account access still requires a human login+consent on
      // com.shortpixel.www (see www-bridge.ts), so leaving it open (no
      // initial access token) matches how the wider MCP ecosystem expects
      // this endpoint to behave.
      registration: {
        enabled: true,
        initialAccessToken: false,
      },

      // draft-ietf-oauth-client-id-metadata-document-02 - Claude's
      // recommended connector mode: client_id is an HTTPS URL this server
      // fetches metadata from directly, no registration step needed.
      clientIdMetadataDocument: {
        enabled: true,
        ack: "draft-02",
      },
    },

    // Where to send the browser when a human decision is needed. The actual
    // login/signup/consent UI lives on com.shortpixel.www; see
    // src/oauth/www-bridge.ts for what happens at this path.
    interactions: {
      url: async (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },

    // accountId is always the ShortPixel numeric user id (as a string),
    // set once in src/oauth/account-store.ts right after
    // com.shortpixel.www's internal exchange-code endpoint resolves it.
    findAccount: async (_ctx, sub) => {
      const account = getAccount(sub);

      if (!account) {
        return undefined;
      }

      return {
        accountId: sub,
        claims: async () => ({ sub }),
      };
    },

    // Embeds the resolved ShortPixel API key directly into the JWT access
    // token, so the resource server never needs to call back into
    // com.shortpixel.www on every tools/call.
    extraTokenClaims: async (_ctx, token) => {
      if (token.kind !== "AccessToken") {
        return undefined;
      }

      const account = getAccount(token.accountId);

      if (!account) {
        return undefined;
      }

      return {
        api_key: account.apiKey,
        shortpixel_user_id: account.userId,
      };
    },
  });

  // nginx terminates TLS and proxies to this process over plain HTTP,
  // setting X-Forwarded-Proto/-For/-Host. Without this, oidc-provider (Koa)
  // builds every self-referencing URL (discovery document, endpoints,
  // redirects) as http:// instead of https://.
  provider.proxy = true;

  return provider;
}
