# ShortPixel MCP Server

Public HTTP MCP server that exposes ShortPixel SPIO image optimization to AI agents (Cursor, Claude Desktop, VS Code, etc.).

## Architecture

```text
AI client (Cursor, Claude, …)
    │
    │  MCP over HTTPS (Streamable HTTP)
    ▼
https://mcp.shortpixel.com/mcp
    │
    │  user's API key in Authorization header
    ▼
ShortPixel SPIO API (api.shortpixel.com)
```

Each request carries the **user's own ShortPixel API key**. The MCP server does not store user keys — it forwards them to the public SPIO API.

## Requirements

- Node.js 20+
- npm

## Install (server)

```bash
npm ci
npm run build
cp .env.example .env
```

Edit `.env` for server settings (port, allowed hosts, upstream API URL). **Do not** put user API keys in server `.env`.

## Run

```bash
npm start
```

Endpoints:

| Path | Method | Description |
|------|--------|-------------|
| `/health` | GET | Health check (no API key) |
| `/ping` | GET | Auth check — returns ok if API key header is present |
| `/mcp` | POST | MCP Streamable HTTP endpoint |

### Quick test (curl)

Server up, no API key:

```bash
curl http://mcp.shortpixel.com:3000/health
```

API key present (simple check):

```bash
curl -i -H "Authorization: Bearer YOUR_API_KEY" http://mcp.shortpixel.com:3000/ping
```

Use `http://` (not `https://`) on port 3000 unless TLS is configured on nginx.

MCP request (important: Streamable HTTP clients must accept both JSON and SSE):

```bash
curl -s -N -X POST http://mcp.shortpixel.com:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Authentication

Send the user's ShortPixel API key on every MCP request:

```http
Authorization: Bearer <shortpixel_api_key>
```

Alternative header:

```http
X-ShortPixel-Api-Key: <shortpixel_api_key>
```

Users without a key can get one at [shortpixel.com](https://shortpixel.com).

## Cursor setup (end user)

```json
{
  "mcpServers": {
    "shortpixel": {
      "url": "https://mcp.shortpixel.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SHORTPIXEL_API_KEY"
      }
    }
  }
}
```

Replace the URL with your deployed host during development (e.g. `http://localhost:3000/mcp`).

## Server environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | no | `3000` | HTTP listen port |
| `ALLOWED_HOSTS` | no | — | Comma-separated Host header allowlist (recommended in production) |
| `SHORTPIXEL_API_URL` | no | `https://api.shortpixel.com/v2` | Upstream SPIO API base URL |
| `SHORTPIXEL_PLUGIN_VERSION` | no | `MCP01` | Plugin version sent to SPIO |
| `LOG_LEVEL` | no | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | no | `text` | `text` = human-readable lines; `json` = structured JSON |
| `LOG_MCP_PROTOCOL` | no | `true` | Log inbound/outbound MCP JSON-RPC payloads |

For internal ShortPixel development, set `SHORTPIXEL_API_URL=https://devapi2.shortpixel.com/v2`.

## Request logging

Logs go to stdout (`pm2 logs` / `npm start`).

**Default (`LOG_FORMAT=text`)** — narrative flow you can follow:

```
[2026-06-30 15:01:53] [1/5] → CLIENT | HTTP POST /mcp | JSON-RPC request: "initialize" (client connects) | id: 0
           {
             "jsonrpc": "2.0",
             "method": "initialize",
             "id": 0,
             "params": { ... }
           }
[2026-06-30 15:01:53] [1/5] ← SERVER | HTTP POST /mcp 200 | JSON-RPC response: "initialize" (client connects)
[2026-06-30 15:01:53] [2/5] → CLIENT | HTTP POST /mcp | JSON-RPC request: "notifications/initialized" (session ready, no response body expected) | id: null
[2026-06-30 15:01:53] [2.5/5] → CLIENT | HTTP POST /mcp | JSON-RPC request: "tools/list" (client asks which tools exist) | id: 1
[2026-06-30 15:01:53] [2.5/5] ← SERVER | HTTP POST /mcp 200 | JSON-RPC response: "tools/list" (client asks which tools exist) | tools discovered: spio_optimize_urls
[2026-06-30 15:02:18] [3/5] → CLIENT | HTTP POST /mcp | JSON-RPC request: "tools/call" (client runs a tool) | id: 2 | tool: "spio_optimize_urls"
[2026-06-30 15:02:18] [4/5] MCP → SPIO API: POST reducer.php (args mapped to SPIO payload) | ...
[2026-06-30 15:02:35] [5/5] MCP ← SPIO API: Success | reduction: 27.41% | optimized: http://api.shortpixel.com/f/...-lossy.jpg | original: ...
[2026-06-30 15:02:35] [3/5] ← SERVER | HTTP POST /mcp 200 | JSON-RPC response: "tools/call" (client runs a tool) | tool: spio_optimize_urls
           { "jsonrpc": "2.0", "id": 2, "result": { ... } }
[2026-06-30 15:02:35]     ✓ round-trip done (16.3s)
```

`LOG_MCP_PROTOCOL=false` keeps only high-level app logs and hides MCP payload dumps.

**Structured (`LOG_FORMAT=json`)** — one JSON object per line:

| Event | When |
|-------|------|
| `http_request` | Every request (method, path, status, duration, MCP method/tool) |
| `spio_request` | Outgoing call to SPIO `reducer.php` |
| `spio_response` | SPIO result summary (status, % improvement) |
| `mcp_auth_missing` | Request without API key |

API keys are masked (`****abcd`). Full keys are never logged.

**Note:** The chat prompt never reaches this server. The LLM (inside the MCP client) turns user text into a structured `tools/call`; the server only sees JSON-RPC arguments and maps them to the SPIO API.

```bash
pm2 logs shortpixel-mcp
# or
npm start
```

Set `LOG_LEVEL=debug` for `tools/list` and extra HTTP lines.

## Deploy on dev server

```bash
cd /xxx/mcp.shortpixel.com
npm ci
npm run build
cp .env.example .env
# set ALLOWED_HOSTS and PORT, then run behind nginx with TLS
npm start
```

Re-upload `package.json` and `package-lock.json` after each dependency change. If build still fails, run `npm ci --include=dev` (some servers set `NODE_ENV=production` which skips devDependencies).

## Available MCP tools

| Tool | Description |
|------|-------------|
| `spio_optimize_urls` | Optimize one or more public image URLs via SPIO reducer API |

## Project layout

```text
src/index.ts                    HTTP server entry point
src/http/auth.ts                API key extraction from requests
src/mcp/create-mcp-server.ts    Per-request MCP server factory
src/clients/spio-api-client.ts  ShortPixel SPIO HTTP client
src/tools/spio-tools.ts         MCP tools
src/http/request-log-middleware.ts HTTP request logging
src/logging/request-logger.ts    Structured JSON logger
src/logging/mcp-protocol-log.ts  MCP protocol payload capture/normalize
```

## Naming conventions

| Kind | Style | Example |
|------|-------|---------|
| Files | kebab-case | `spio-api-client.ts` |
| Classes | PascalCase | `SpioApiClient` |
| Methods | camelCase | `optimizeUrls` |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run HTTP MCP server |
| `npm run dev` | Run with tsx (no build step) |
