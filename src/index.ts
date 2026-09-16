#!/usr/bin/env node

import type { Request, Response } from "express";
import cors from "cors";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getAllowedHosts, getMcpRegistryAuthRecord, getNumber, getOauthIssuer } from "./config/environment.js";
import { extractApiKey } from "./http/auth.js";
import { isAuthRequiredForMcpMethod, readMcpMethod } from "./http/mcp-auth.js";
import { requestLogMiddleware } from "./http/request-log-middleware.js";
import { requestLogger } from "./logging/request-logger.js";
import { createMcpServer } from "./mcp/create-mcp-server.js";
import { createOauthProvider } from "./oauth/provider.js";
import { MCP_RESOURCE_IDENTIFIER } from "./oauth/resource.js";
import { createInteractionHandler, createWwwCallbackHandler } from "./oauth/www-bridge.js";

const allowedHosts = getAllowedHosts();
const app = createMcpExpressApp({
  host: "0.0.0.0",
  ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
});

// nginx is the sole entry point (proxying from localhost); trust its
// X-Forwarded-* headers so request.ip reflects the real client, not nginx.
app.set("trust proxy", true);

const oauthProvider = createOauthProvider();
const protectedResourceMetadataUrl = new URL("/.well-known/oauth-protected-resource", getOauthIssuer()).toString();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-ShortPixel-Api-Key",
      "mcp-session-id",
      "Last-Event-ID",
      "mcp-protocol-version",
    ],
    exposedHeaders: ["mcp-session-id", "mcp-protocol-version"],
  }),
);

app.use(requestLogMiddleware);

app.get("/.well-known/mcp-registry-auth", (_request: Request, response: Response) => {
  const record = getMcpRegistryAuthRecord();

  if (!record) {
    response.status(404).type("text/plain").send("Not found\n");
    return;
  }

  response.status(200).type("text/plain; charset=utf-8").send(`${record}\n`);
});

// RFC 9728 - tells an OAuth client where this resource's Authorization
// Server is, so it knows where to send the user to connect.
app.get("/.well-known/oauth-protected-resource", (_request: Request, response: Response) => {
  response.json({
    resource: MCP_RESOURCE_IDENTIFIER,
    authorization_servers: [getOauthIssuer()],
  });
});

app.get("/health", (_request: Request, response: Response) => {
  response.json({
    status: "ok",
    service: "shortpixel-mcp",
  });
});

app.get("/ping", async (request: Request, response: Response) => {
  const apiKey = await extractApiKey(request);

  if (!apiKey) {
    response.status(401).json({
      status: "error",
      message: "Missing API key. Send Authorization: Bearer <api_key>",
    });
    return;
  }

  response.json({
    status: "ok",
    service: "shortpixel-mcp",
    auth: "ok",
  });
});

// The OAuth bridge to com.shortpixel.www: see src/oauth/www-bridge.ts.
app.get("/interaction/:uid", createInteractionHandler(oauthProvider));
app.get("/oauth/www-callback", createWwwCallbackHandler(oauthProvider));

app.post("/mcp", async (request: Request, response: Response) => {
  const mcpMethod = readMcpMethod(request.body);
  const apiKey = await extractApiKey(request);
  const requiresAuth = isAuthRequiredForMcpMethod(mcpMethod);

  if (requiresAuth && !apiKey) {
    requestLogger.warn("mcp_auth_missing", { path: "/mcp", mcpMethod });
    response
      .status(401)
      .set("WWW-Authenticate", `Bearer resource_metadata="${protectedResourceMetadataUrl}"`)
      .json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            "Missing ShortPixel API key. Send Authorization: Bearer <api_key> (a raw ShortPixel API key, or an OAuth access token from this server) or X-ShortPixel-Api-Key. Get a key at https://shortpixel.com",
        },
        id: null,
      });
    return;
  }

  const server = createMcpServer(apiKey ?? "__MCP_DISCOVERY_ONLY__");

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);

    response.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    requestLogger.error("mcp_request_failed", { message });

    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_request: Request, response: Response) => {
  response.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
});

app.delete("/mcp", (_request: Request, response: Response) => {
  response.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
});

// Everything oidc-provider itself owns: /auth, /token, /jwks,
// /.well-known/openid-configuration, /.well-known/oauth-authorization-server,
// /token/revocation, etc. Mounted last so it only ever sees requests none of
// the routes above already answered.
const oauthCallback = oauthProvider.callback();
app.use((request: Request, response: Response, next) => {
  oauthCallback(request, response).catch(next);
});

const port = getNumber("PORT", 3000);

app.listen(port, "0.0.0.0", (error?: Error) => {
  if (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }

  console.log(`ShortPixel MCP HTTP server listening on port ${port}`);
  console.log(`Health: http://0.0.0.0:${port}/health`);
  console.log(`Ping:   http://0.0.0.0:${port}/ping`);
  console.log(`MCP:    http://0.0.0.0:${port}/mcp`);
});

process.on("SIGINT", () => {
  process.exit(0);
});
