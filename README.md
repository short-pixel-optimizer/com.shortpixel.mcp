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
| `/health` | GET | Health check |
| `/mcp` | POST | MCP Streamable HTTP endpoint |

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

For internal ShortPixel development, set `SHORTPIXEL_API_URL=https://devapi2.shortpixel.com/v2`.

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
src/config/environment.ts       Server configuration
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
