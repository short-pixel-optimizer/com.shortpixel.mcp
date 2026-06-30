#!/usr/bin/env node

import type { Request, Response } from "express";
import cors from "cors";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getAllowedHosts, getNumber } from "./config/environment.js";
import { extractApiKey } from "./http/auth.js";
import { createMcpServer } from "./mcp/create-mcp-server.js";

const allowedHosts = getAllowedHosts();
const app = createMcpExpressApp({
  host: "0.0.0.0",
  ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
});

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

app.get("/health", (_request: Request, response: Response) => {
  response.json({
    status: "ok",
    service: "shortpixel-mcp",
  });
});

app.post("/mcp", async (request: Request, response: Response) => {
  const apiKey = extractApiKey(request);

  if (!apiKey) {
    response.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Missing ShortPixel API key. Send Authorization: Bearer <api_key> or X-ShortPixel-Api-Key. Get a key at https://shortpixel.com",
      },
      id: null,
    });
    return;
  }

  const server = createMcpServer(apiKey);

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
    console.error("MCP request failed:", error);

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

const port = getNumber("PORT", 3000);

app.listen(port, "0.0.0.0", (error?: Error) => {
  if (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }

  console.log(`ShortPixel MCP HTTP server listening on port ${port}`);
  console.log(`Health: http://0.0.0.0:${port}/health`);
  console.log(`MCP:    http://0.0.0.0:${port}/mcp`);
});

process.on("SIGINT", () => {
  process.exit(0);
});
