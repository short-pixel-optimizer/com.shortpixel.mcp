import { get } from "../config/environment.js";
import { requestLogger } from "./request-logger.js";

function isMcpProtocolLoggingEnabled(): boolean {
  const value = (get("LOG_MCP_PROTOCOL", "true") ?? "true").toLowerCase();
  return value !== "false" && value !== "0";
}

function readRpcMessage(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  return body as Record<string, unknown>;
}

function readToolName(message: Record<string, unknown>): string | undefined {
  if (message.method !== "tools/call" || !message.params || typeof message.params !== "object") {
    return undefined;
  }

  const params = message.params as Record<string, unknown>;
  return typeof params.name === "string" ? params.name : undefined;
}

function chunkToBuffer(chunk: unknown): Buffer {
  if (chunk === undefined || chunk === null) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }

  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf8");
  }

  return Buffer.from(String(chunk), "utf8");
}

function parseSseOrJson(raw: string): unknown {
  const trimmed = raw.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  const dataLines = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (dataLines.length > 0) {
    const lastLine = dataLines[dataLines.length - 1];

    try {
      return JSON.parse(lastLine ?? "");
    } catch {
      return { _format: "sse", _raw: trimmed };
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function prettifyMcpToolResult(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  const result = record.result;

  if (!result || typeof result !== "object") {
    return payload;
  }

  const resultRecord = result as Record<string, unknown>;
  const content = resultRecord.content;

  if (!Array.isArray(content)) {
    return payload;
  }

  const normalizedContent = content.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    const entry = item as Record<string, unknown>;

    if (entry.type === "text" && typeof entry.text === "string") {
      try {
        return {
          ...entry,
          text: JSON.parse(entry.text),
        };
      } catch {
        return item;
      }
    }

    return item;
  });

  return {
    ...record,
    result: {
      ...resultRecord,
      content: normalizedContent,
    },
  };
}

function normalizeOutboundPayload(responseBody: unknown): unknown {
  if (responseBody === undefined) {
    return undefined;
  }

  let parsed: unknown = responseBody;

  if (typeof responseBody === "string") {
    parsed = parseSseOrJson(responseBody);
  }

  return prettifyMcpToolResult(parsed);
}

function readToolNamesFromToolsList(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const result = record.result;

  if (!result || typeof result !== "object") {
    return [];
  }

  const tools = (result as Record<string, unknown>).tools;

  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") {
        return undefined;
      }

      const name = (tool as Record<string, unknown>).name;
      return typeof name === "string" ? name : undefined;
    })
    .filter((name): name is string => Boolean(name));
}

export function logInboundMcpProtocol(
  body: unknown,
  requestHeaders: Record<string, unknown>,
  clientIp?: string,
  httpMethod = "POST",
  path = "/mcp",
): void {
  if (!isMcpProtocolLoggingEnabled()) {
    return;
  }

  const message = readRpcMessage(body);

  if (!message) {
    return;
  }

  requestLogger.info("mcp_protocol_in", {
    clientIp,
    httpMethod,
    path,
    method: message.method,
    id: message.id,
    toolName: readToolName(message),
    headers: requestHeaders,
    payload: message,
  });
}

export function logOutboundMcpProtocol(
  inboundBody: unknown,
  responseBody: unknown,
  statusCode: number,
  responseHeaders: Record<string, unknown>,
  httpMethod = "POST",
  path = "/mcp",
): void {
  if (!isMcpProtocolLoggingEnabled()) {
    return;
  }

  const message = readRpcMessage(inboundBody);

  if (!message || typeof message.method !== "string") {
    return;
  }

  const normalizedPayload = normalizeOutboundPayload(responseBody);

  requestLogger.info("mcp_protocol_out", {
    httpMethod,
    path,
    method: message.method,
    id: message.id,
    toolName: readToolName(message),
    toolNames: message.method === "tools/list"
      ? readToolNamesFromToolsList(normalizedPayload)
      : undefined,
    statusCode,
    headers: responseHeaders,
    payload: normalizedPayload,
    payloadMissing: responseBody === undefined,
  });
}

export function captureResponseBody(response: {
  json: (body: unknown) => unknown;
  send: (body: unknown) => unknown;
  write: (...args: never[]) => boolean;
  end: (...args: never[]) => unknown;
}): () => unknown {
  let body: unknown;
  const chunks: Buffer[] = [];

  const appendChunk = (chunk: unknown): void => {
    if (chunk === undefined || chunk === null) {
      return;
    }

    chunks.push(chunkToBuffer(chunk));
  };

  const flushChunks = (): void => {
    if (chunks.length === 0) {
      return;
    }

    body = parseSseOrJson(Buffer.concat(chunks).toString("utf8"));
    chunks.length = 0;
  };

  const originalJson = response.json.bind(response);
  response.json = (data: unknown) => {
    body = data;
    return originalJson(data);
  };

  const originalSend = response.send.bind(response);
  response.send = (data: unknown) => {
    if (typeof data === "string") {
      body = parseSseOrJson(data);
    } else {
      body = data;
    }

    return originalSend(data);
  };

  const originalWrite = response.write.bind(response);
  response.write = ((chunk: unknown, ...args: unknown[]) => {
    appendChunk(chunk);
    return originalWrite(chunk as never, ...(args as never[]));
  }) as typeof response.write;

  const originalEnd = response.end.bind(response);
  response.end = ((chunk?: unknown, ...args: unknown[]) => {
    appendChunk(chunk);
    flushChunks();
    return originalEnd(chunk as never, ...(args as never[]));
  }) as typeof response.end;

  return () => body;
}
