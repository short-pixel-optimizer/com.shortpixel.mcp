/**
 * The bridge between this server's own OAuth protocol engine (oidc-provider)
 * and com.shortpixel.www, where the actual human identity check happens
 * (login/signup, already existing; consent, the new /oauth/authorize page).
 *
 * Two legs:
 *  - GET /interaction/:uid  - oidc-provider needs a human decision; we
 *    immediately bounce the browser to com.shortpixel.www's consent screen,
 *    using the interaction's own uid as the OAuth `state` for this inner hop.
 *  - GET /oauth/www-callback - com.shortpixel.www redirects back here after
 *    login+consent, with a one-time code. We redeem it server-to-server for
 *    {userId, apiKey}, record the account, and finish the interaction.
 */

import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import type Provider from "oidc-provider";
import {
  getOauthInternalSecret,
  getOauthIssuer,
  getOauthWwwAuthorizeUrl,
  getOauthWwwExchangeUrl,
} from "../config/environment.js";
import { requestLogger } from "../logging/request-logger.js";
import { storeAccount } from "./account-store.js";
import { isVerifiedClientRedirect } from "./clients.js";
import { MCP_RESOURCE_IDENTIFIER, MCP_SCOPE } from "./resource.js";

function getWwwCallbackUrl(): string {
  return new URL("/oauth/www-callback", getOauthIssuer()).toString();
}

function getStringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The client's own redirect_uri (Claude/ChatGPT/etc's, not our
// www-callback), shown on the consent screen next to the client's
// self-reported name - a DCR/CIMD-resolved client_name is unverified, so
// the domain the browser will actually land on is the user's real signal.
// Loopback redirects (desktop apps like Cursor) return "" so the consent
// screen hides the line: "localhost" tells the user nothing, since any
// local program can listen there - the unverified warning covers it.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function getRedirectUriHost(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return LOOPBACK_HOSTNAMES.has(url.hostname) ? "" : url.host;
  } catch {
    return "";
  }
}

interface SignedClientInfo {
  clientInfo: string;
  signature: string;
}

// Everything the consent screen displays (name, domain, verified badge) is
// packed into one base64url JSON blob and HMAC-signed with the secret
// com.shortpixel.www already shares with us. PHP verifies the signature
// over the exact bytes it received, so nobody can hand-craft a link that
// shows "Claude, verified" for their own client_id. `state` is included to
// bind the blob to this one interaction.
export function signClientInfo(
  secret: string,
  info: {
    client_id: string;
    client_name: string;
    client_domain: string;
    verified: boolean;
    state: string;
  },
): SignedClientInfo {
  const clientInfo = Buffer.from(JSON.stringify(info), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(clientInfo).digest("hex");
  return { clientInfo, signature };
}

function logHandlerError(event: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  requestLogger.error(event, { message, stack });
}

export function createInteractionHandler(provider: Provider) {
  return async (request: Request, response: Response): Promise<void> => {
    try {
      const secret = getOauthInternalSecret();

      if (!secret) {
        requestLogger.error("oauth_missing_internal_secret", {});
        response.status(500).send("Internal server error.");
        return;
      }

      const interaction = await provider.interactionDetails(request, response);
      const params = interaction.params as Record<string, unknown>;
      const clientId = getStringParam(params.client_id);
      const clientRedirectUri = getStringParam(params.redirect_uri);

      // Resolves uniformly whether the client came from clients.ts, DCR, or
      // CIMD - com.shortpixel.www never needs to know which.
      const client = await provider.Client.find(clientId);
      const clientName = client?.clientName || clientId;
      const clientDomain = getRedirectUriHost(clientRedirectUri);
      const verified = isVerifiedClientRedirect(clientRedirectUri);

      // Logged so new real clients' redirect hosts (e.g. Mistral's) can be
      // spotted and, once confirmed, added to the verified list.
      requestLogger.info("oauth_interaction_client", { clientName, clientDomain, verified });

      const { clientInfo, signature } = signClientInfo(secret, {
        client_id: clientId,
        client_name: clientName,
        client_domain: clientDomain,
        verified,
        state: interaction.uid,
      });

      const url = new URL(getOauthWwwAuthorizeUrl());
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("client_info", clientInfo);
      url.searchParams.set("client_info_sig", signature);
      url.searchParams.set("redirect_uri", getWwwCallbackUrl());
      url.searchParams.set("state", interaction.uid);
      // com.shortpixel.www only checks this is present and S256 - the real
      // PKCE verification (Claude's code_verifier against Claude's own
      // code_challenge) happens entirely within oidc-provider, never here.
      url.searchParams.set("code_challenge", getStringParam(params.code_challenge) || interaction.uid);
      url.searchParams.set("code_challenge_method", "S256");

      response.redirect(url.toString());
    } catch (error) {
      logHandlerError("oauth_interaction_error", error);

      if (!response.headersSent) {
        response.status(500).send("Internal server error.");
      }
    }
  };
}

interface ExchangeCodeResponse {
  userId: number;
  apiKey: string;
  clientId: string;
}

async function exchangeCode(code: string): Promise<ExchangeCodeResponse | undefined> {
  const secret = getOauthInternalSecret();

  if (!secret) {
    requestLogger.error("oauth_missing_internal_secret", {});
    return undefined;
  }

  try {
    const response = await fetch(getOauthWwwExchangeUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": secret,
      },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      requestLogger.warn("oauth_exchange_failed", { status: response.status });
      return undefined;
    }

    return (await response.json()) as ExchangeCodeResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    requestLogger.error("oauth_exchange_error", { message });
    return undefined;
  }
}

export function createWwwCallbackHandler(provider: Provider) {
  return async (request: Request, response: Response): Promise<void> => {
    try {
      const interactionUid = getStringParam(request.query.state);
      const code = getStringParam(request.query.code);
      const deniedError = getStringParam(request.query.error);

      if (!interactionUid) {
        response.status(400).send("Missing state.");
        return;
      }

      if (deniedError || !code) {
        await provider.interactionFinished(
          request,
          response,
          {
            error: deniedError || "access_denied",
            error_description: "The user did not approve the request.",
          },
          { mergeWithLastSubmission: false },
        );
        return;
      }

      const exchangeResult = await exchangeCode(code);

      if (!exchangeResult) {
        await provider.interactionFinished(
          request,
          response,
          {
            error: "access_denied",
            error_description: "Could not verify the ShortPixel account.",
          },
          { mergeWithLastSubmission: false },
        );
        return;
      }

      const interaction = await provider.interactionDetails(request, response);
      const params = interaction.params as Record<string, unknown>;
      const authoritativeClientId = getStringParam(params.client_id);

      // The consent screen only accepted a signed blob bound to this exact
      // uid, so a different state here means the approval came from some
      // other flow than the one this browser's cookie belongs to.
      if (interactionUid !== interaction.uid) {
        requestLogger.error("oauth_state_mismatch", {});
        await provider.interactionFinished(
          request,
          response,
          {
            error: "access_denied",
            error_description: "State mismatch detected.",
          },
          { mergeWithLastSubmission: false },
        );
        return;
      }

      // com.shortpixel.www's clientId is audit data it echoes back from its
      // own DB row - it never decides which client gets the grant, but a
      // mismatch here means the consent screen a human just approved showed
      // a different client than the one this cookie-bound interaction was
      // actually opened for (a stale/reused interaction, or a hand-crafted
      // link to the www-authorize page). Refuse rather than silently trust
      // whichever one PHP reports.
      if (exchangeResult.clientId !== authoritativeClientId) {
        requestLogger.error("oauth_client_id_mismatch", {
          expected: authoritativeClientId,
          received: exchangeResult.clientId,
        });
        await provider.interactionFinished(
          request,
          response,
          {
            error: "access_denied",
            error_description: "Client mismatch detected.",
          },
          { mergeWithLastSubmission: false },
        );
        return;
      }

      const accountId = String(exchangeResult.userId);
      storeAccount({ userId: exchangeResult.userId, apiKey: exchangeResult.apiKey });

      const grant = new provider.Grant({
        accountId,
        clientId: authoritativeClientId,
      });
      grant.addResourceScope(MCP_RESOURCE_IDENTIFIER, MCP_SCOPE);
      const grantId = await grant.save();

      await provider.interactionFinished(
        request,
        response,
        {
          login: { accountId },
          consent: { grantId },
        },
        { mergeWithLastSubmission: false },
      );
    } catch (error) {
      logHandlerError("oauth_www_callback_error", error);

      if (!response.headersSent) {
        response.status(500).send("Internal server error.");
      }
    }
  };
}
