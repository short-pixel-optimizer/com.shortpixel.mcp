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
function getRedirectUriHost(redirectUri: string): string {
  try {
    return new URL(redirectUri).host;
  } catch {
    return "";
  }
}

function logHandlerError(event: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  requestLogger.error(event, { message, stack });
}

export function createInteractionHandler(provider: Provider) {
  return async (request: Request, response: Response): Promise<void> => {
    try {
      const interaction = await provider.interactionDetails(request, response);
      const params = interaction.params as Record<string, unknown>;
      const clientId = getStringParam(params.client_id);

      // Resolves uniformly whether the client came from clients.ts, DCR, or
      // CIMD - com.shortpixel.www never needs to know which.
      const client = await provider.Client.find(clientId);
      const clientName = client?.clientName || clientId;
      const clientDomain = getRedirectUriHost(getStringParam(params.redirect_uri));

      const url = new URL(getOauthWwwAuthorizeUrl());
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("client_name", clientName);
      url.searchParams.set("client_domain", clientDomain);
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

      const accountId = String(exchangeResult.userId);
      storeAccount({ userId: exchangeResult.userId, apiKey: exchangeResult.apiKey });

      const interaction = await provider.interactionDetails(request, response);
      const params = interaction.params as Record<string, unknown>;

      const grant = new provider.Grant({
        accountId,
        clientId: getStringParam(params.client_id),
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
