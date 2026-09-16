import type { NextFunction, Request, Response } from "express";
import {
  captureResponseBody,
  logInboundMcpProtocol,
  logOutboundMcpProtocol,
} from "../logging/mcp-protocol-log.js";
import { maskApiKey, requestLogger } from "../logging/request-logger.js";
import { extractApiKey } from "./auth.js";

function readMcpFields(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") {
    return {};
  }

  const payload = body as Record<string, unknown>;
  const fields: Record<string, unknown> = {};

  if (typeof payload.method === "string") {
    fields.mcpMethod = payload.method;
  }

  if (payload.id !== undefined) {
    fields.mcpId = payload.id;
  }

  if (payload.method === "tools/call" && payload.params && typeof payload.params === "object") {
    const params = payload.params as Record<string, unknown>;

    if (typeof params.name === "string") {
      fields.toolName = params.name;
    }

    if (params.arguments && typeof params.arguments === "object") {
      const args = params.arguments as Record<string, unknown>;
      fields.toolArguments = args;

      if (Array.isArray(args.urls)) {
        fields.imageUrls = args.urls;
      }
    }
  }

  return fields;
}

export function requestLogMiddleware(request: Request, response: Response, next: NextFunction): void {
  const startedAt = Date.now();
  // Headers are already available at this point regardless of body-parsing
  // order, so it's safe to start this now and only await it once the
  // response finishes - purely for the masked key in the log line below
  const apiKeyPromise = extractApiKey(request);
  const getResponseBody = request.path === "/mcp" && request.method === "POST"
    ? captureResponseBody(response as Parameters<typeof captureResponseBody>[0])
    : undefined;

  if (request.path === "/mcp" && request.method === "POST") {
    logInboundMcpProtocol(request.body, request.headers, request.ip, request.method, request.path);
  }

  response.on("finish", () => {
    void logCompletedRequest();
  });

  async function logCompletedRequest(): Promise<void> {
    const apiKey = await apiKeyPromise;
    const durationMs = Date.now() - startedAt;
    const fields: Record<string, unknown> = {
      httpMethod: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs,
      clientIp: request.ip,
      host: request.headers.host,
    };

    if (apiKey) {
      fields.apiKey = maskApiKey(apiKey);
    }

    if (request.path === "/mcp" && request.method === "POST") {
      Object.assign(fields, readMcpFields(request.body));

      if (getResponseBody) {
        logOutboundMcpProtocol(
          request.body,
          getResponseBody(),
          response.statusCode,
          response.getHeaders(),
          request.method,
          request.path,
        );
      }
    }

    const level = response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info";

    if (fields.mcpMethod === "tools/call") {
      requestLogger.info("mcp_tool_call_complete", {
        toolName: fields.toolName,
        durationMs,
        status: response.statusCode,
      });
      return;
    }

    requestLogger[level]("http_request", fields);
  }

  next();
}
