import { get } from "../config/environment.js";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFormat = "json" | "text";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) {
    return "****";
  }

  return `****${apiKey.slice(-4)}`;
}

function formatClockTime(date = new Date()): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function formatJsonBlock(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  if (!serialized) {
    return null;
  }

  return serialized
    .split("\n")
    .map((line) => `           ${line}`)
    .join("\n");
}

function formatMcpStep(method: unknown): string | null {
  if (method === "initialize") {
    return "[1/5]";
  }

  if (method === "notifications/initialized") {
    return "[2/5]";
  }

  if (method === "tools/call") {
    return "[3/5]";
  }

  return null;
}

function formatUrls(urls: unknown): string {
  if (!Array.isArray(urls) || urls.length === 0) {
    return "(no urls)";
  }

  return urls.map((url) => String(url)).join(", ");
}

export class RequestLogger {
  private readonly minLevel: LogLevel;
  private readonly format: LogFormat;

  constructor(
    minLevel = (get("LOG_LEVEL", "info") as LogLevel) ?? "info",
    format = (get("LOG_FORMAT", "text") as LogFormat) ?? "text",
  ) {
    this.minLevel = minLevel;
    this.format = format === "json" ? "json" : "text";
  }

  debug(event: string, fields: Record<string, unknown> = {}): void {
    this.write("debug", event, fields);
  }

  info(event: string, fields: Record<string, unknown> = {}): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields: Record<string, unknown> = {}): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields: Record<string, unknown> = {}): void {
    this.write("error", event, fields);
  }

  private write(level: LogLevel, event: string, fields: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) {
      return;
    }

    if (this.format === "text") {
      const lines = this.toTextLines(level, event, fields);

      if (!lines || lines.length === 0) {
        return;
      }

      for (const line of lines) {
        this.printLine(level, line);
      }

      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    };

    this.printLine(level, JSON.stringify(entry));
  }

  private printLine(level: LogLevel, line: string): void {
    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  private toTextLines(level: LogLevel, event: string, fields: Record<string, unknown>): string[] | null {
    const time = formatClockTime();

    switch (event) {
      case "http_request": {
        const line = this.httpRequestToText(time, level, fields);
        return line ? [line] : null;
      }
      case "mcp_protocol_in": {
        const method = fields.method ?? "?";
        const step = formatMcpStep(method);
        const stepPrefix = step ? `${step} ` : "";
        const toolName = fields.toolName;

        if (method === "tools/call" && typeof toolName === "string") {
          const lines = [
            `[${time}] ${stepPrefix}MCP protocol IN | decides to use tool: "${toolName}" (client sent tools/call)`,
          ];
          const json = formatJsonBlock(fields.payload);

          if (json) {
            lines.push(json);
          }

          return lines;
        }

        const lines = [
          `[${time}] ${stepPrefix}MCP protocol IN | method: ${String(method)} | id: ${String(fields.id ?? "null")}`,
        ];
        const json = formatJsonBlock(fields.payload);

        if (json) {
          lines.push(json);
        }

        return lines;
      }
      case "mcp_protocol_out": {
        const lines = [
          `[${time}] MCP protocol OUT | tools/call response | tool: ${String(fields.toolName ?? "?")} | HTTP ${String(fields.statusCode ?? "?")}`,
        ];

        if (fields.payloadMissing) {
          lines.push("           (response body not captured by HTTP middleware)");
          return lines;
        }

        const json = formatJsonBlock(fields.payload);

        if (json) {
          lines.push(json);
        }

        return lines;
      }
      case "mcp_tool_call_complete": {
        const durationSec = typeof fields.durationMs === "number"
          ? (fields.durationMs / 1000).toFixed(1)
          : "?";

        return [`[${time}] MCP → MCP client: tool result sent (${durationSec}s)`];
      }
      case "spio_request":
        return [`[${time}] [4/5] MCP → SPIO API: POST reducer.php (args mapped to SPIO payload) | images: ${fields.imageCount} | urls: ${formatUrls(fields.imageUrls)} | lossy=${fields.options && typeof fields.options === "object" ? (fields.options as Record<string, unknown>).lossy : "?"} | wait=${fields.options && typeof fields.options === "object" ? (fields.options as Record<string, unknown>).wait : "?"}s`];
      case "spio_response": {
        const results = Array.isArray(fields.results) ? fields.results : [];
        const first = results[0] as Record<string, unknown> | undefined;
        const code = first?.code ?? "?";
        const message = first?.message ?? "unknown";
        const improvement = first?.percentImprovement;
        const optimizedUrl = first?.optimizedUrl ?? "?";
        const originalUrl = first?.originalUrl ?? "?";

        if (code === "2" || code === 2) {
          return [`[${time}] [5/5] MCP ← SPIO API: ${message} | reduction: ${improvement}% | optimized: ${optimizedUrl} | original: ${originalUrl}`];
        }

        return [`[${time}] [5/5] MCP ← SPIO API: error code ${code} | ${message} | original: ${originalUrl}`];
      }
      case "mcp_auth_missing":
        return [`[${time}] MCP: rejected — missing API key (Authorization: Bearer ...)`];
      case "mcp_request_failed":
        return [`[${time}] MCP: internal error — ${fields.message ?? "unknown"}`];
      case "spio_request_failed":
        return [`[${time}] MCP → SPIO API: network error — ${fields.message ?? "unknown"}`];
      case "spio_http_error":
        return [`[${time}] MCP ← SPIO API: HTTP ${fields.httpStatus} — ${fields.bodyPreview ?? ""}`];
      case "spio_invalid_json":
        return [`[${time}] MCP ← SPIO API: invalid JSON response`];
      case "spio_unexpected_format":
        return [`[${time}] MCP ← SPIO API: unexpected response — ${fields.bodyPreview ?? ""}`];
      default:
        return null;
    }
  }

  private httpRequestToText(
    time: string,
    level: LogLevel,
    fields: Record<string, unknown>,
  ): string | null {
    const mcpMethod = fields.mcpMethod;

    if (fields.path === "/ping") {
      return `[${time}] Ping OK — API key ${fields.apiKey ?? "present"}`;
    }

    if (fields.path === "/health") {
      return null;
    }

    if (fields.httpMethod === "GET" && fields.path === "/mcp" && fields.status === 405) {
      return null;
    }

    if (mcpMethod === "tools/call") {
      return null;
    }

    if (mcpMethod === "initialize" || mcpMethod === "notifications/initialized") {
      return null;
    }

    if (mcpMethod === "tools/list") {
      return null;
    }

    if (fields.path === "/mcp" && fields.httpMethod === "POST") {
      return `[${time}] MCP HTTP ${fields.status} | ${String(mcpMethod ?? "request")} | ${fields.durationMs}ms`;
    }

    if (level === "warn" || level === "error") {
      return `[${time}] HTTP ${fields.httpMethod} ${fields.path} → ${fields.status}`;
    }

    return null;
  }
}

export const requestLogger = new RequestLogger();
