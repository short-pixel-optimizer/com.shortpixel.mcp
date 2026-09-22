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

const LOG_INDENT = "           ";
const LOG_SUB_INDENT = `${LOG_INDENT}  `;

const SENSITIVE_REQUEST_HEADERS = new Set([
  "authorization",
  "x-shortpixel-api-key",
  "cookie",
]);

export function sanitizeHttpHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object") {
    return {};
  }

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }

    const normalized = Array.isArray(value) ? value.join(", ") : String(value);
    const lower = key.toLowerCase();

    if (lower === "authorization" && normalized.toLowerCase().startsWith("bearer ")) {
      const token = normalized.slice(7).trim();
      sanitized[key] = `Bearer ${maskApiKey(token)}`;
      continue;
    }

    if (lower === "x-shortpixel-api-key") {
      sanitized[key] = maskApiKey(normalized);
      continue;
    }

    if (SENSITIVE_REQUEST_HEADERS.has(lower)) {
      sanitized[key] = "****";
      continue;
    }

    sanitized[key] = normalized;
  }

  return sanitized;
}

function formatSectionLines(label: string, value: unknown, emptyLabel = "(empty)"): string[] {
  const lines = [`${LOG_INDENT}${label}:`];

  if (value === undefined || value === null) {
    lines.push(`${LOG_SUB_INDENT}${emptyLabel}`);
    return lines;
  }

  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) {
    lines.push(`${LOG_SUB_INDENT}${emptyLabel}`);
    return lines;
  }

  if (label === "Headers" && typeof value === "object" && !Array.isArray(value)) {
    const headers = sanitizeHttpHeaders(value);
    const keys = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    if (keys.length === 0) {
      lines.push(`${LOG_SUB_INDENT}${emptyLabel}`);
      return lines;
    }

    for (const key of keys) {
      lines.push(`${LOG_SUB_INDENT}${key}: ${headers[key]}`);
    }

    return lines;
  }

  const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  if (!serialized) {
    lines.push(`${LOG_SUB_INDENT}${emptyLabel}`);
    return lines;
  }

  for (const line of serialized.split("\n")) {
    lines.push(`${LOG_SUB_INDENT}${line}`);
  }

  return lines;
}

function appendStructuredExchange(
  lines: string[],
  sections: Array<{ label: string; value: unknown; emptyLabel?: string }>,
): string[] {
  for (const section of sections) {
    lines.push(...formatSectionLines(section.label, section.value, section.emptyLabel));
  }

  return lines;
}

function formatMcpStep(method: unknown): string | null {
  if (method === "initialize") {
    return "[1/5]";
  }

  if (method === "notifications/initialized") {
    return "[2/5]";
  }

  if (method === "tools/list") {
    return "[2.5/5]";
  }

  if (method === "tools/call") {
    return "[3/5]";
  }

  return null;
}

function formatJsonRpcMethodLabel(method: unknown): string {
  if (method === "tools/list") {
    return '"tools/list" (client asks which tools exist)';
  }

  if (method === "tools/call") {
    return '"tools/call" (client runs a tool)';
  }

  if (method === "initialize") {
    return '"initialize" (client connects)';
  }

  if (method === "notifications/initialized") {
    return '"notifications/initialized" (session ready, no response body expected)';
  }

  return `"${String(method)}"`;
}

function formatOutboundKind(method: unknown, payloadMissing: boolean): string {
  if (method === "notifications/initialized" || payloadMissing) {
    return "HTTP ack";
  }

  return "JSON-RPC response";
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
        const jsonRpcMethod = fields.method ?? "?";
        const step = formatMcpStep(jsonRpcMethod);
        const stepPrefix = step ? `${step} ` : "";
        const httpMethod = String(fields.httpMethod ?? "POST");
        const path = String(fields.path ?? "/mcp");
        const id = fields.id !== undefined ? String(fields.id) : "null";
        const toolName = fields.toolName;
        let extra = "";

        if (jsonRpcMethod === "tools/call" && typeof toolName === "string") {
          extra = ` | tool: "${toolName}"`;
        }

        const lines = [
          `[${time}] ${stepPrefix}CLIENT → MCP | HTTP ${httpMethod} ${path} | JSON-RPC request: ${formatJsonRpcMethodLabel(jsonRpcMethod)} | id: ${id}${extra}`,
        ];

        return appendStructuredExchange(lines, [
          { label: "Headers", value: fields.headers, emptyLabel: "(none)" },
          { label: "Body", value: fields.payload, emptyLabel: "(empty)" },
        ]);
      }
      case "mcp_protocol_out": {
        const jsonRpcMethod = fields.method ?? "?";
        const step = formatMcpStep(jsonRpcMethod);
        const stepPrefix = step ? `${step} ` : "";
        const httpMethod = String(fields.httpMethod ?? "POST");
        const path = String(fields.path ?? "/mcp");
        const statusCode = String(fields.statusCode ?? "?");
        let extra = "";

        if (jsonRpcMethod === "tools/list") {
          const toolNames = Array.isArray(fields.toolNames)
            ? fields.toolNames.join(", ")
            : "?";

          extra = ` | tools discovered: ${toolNames}`;
        } else if (jsonRpcMethod === "tools/call") {
          extra = ` | tool: ${String(fields.toolName ?? "?")}`;
        }

        const payloadMissing = Boolean(fields.payloadMissing);
        const outboundKind = formatOutboundKind(jsonRpcMethod, payloadMissing);

        const lines = [
          `[${time}] ${stepPrefix}MCP → CLIENT | HTTP ${httpMethod} ${path} ${statusCode} | ${outboundKind}: ${formatJsonRpcMethodLabel(jsonRpcMethod)}${extra}`,
        ];

        const bodyEmptyLabel = jsonRpcMethod === "notifications/initialized" || payloadMissing
          ? "(empty — JSON-RPC notification, no response body)"
          : "(empty)";

        return appendStructuredExchange(lines, [
          { label: "Headers", value: fields.headers, emptyLabel: "(none)" },
          {
            label: "Body",
            value: payloadMissing ? undefined : fields.payload,
            emptyLabel: bodyEmptyLabel,
          },
        ]);
      }
      case "mcp_tool_call_complete": {
        const durationSec = typeof fields.durationMs === "number"
          ? (fields.durationMs / 1000).toFixed(1)
          : "?";

        return [`[${time}]     ✓ round-trip done (${durationSec}s)`];
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
        // Any event not given its own narrative line above still gets
        // printed - silently dropping unknown events here (as before) meant
        // every warn()/error() call added elsewhere was invisible in text
        // format, with no signal that logging itself was the problem.
        return [`[${time}] ${event} | ${JSON.stringify(fields)}`];
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
