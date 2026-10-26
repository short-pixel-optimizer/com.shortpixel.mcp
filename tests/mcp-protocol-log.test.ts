import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

/**
 * MCP protocol logging in JSON format
 * The logger singleton reads LOG_FORMAT at import time, so it is set before the dynamic import
 */

process.env.LOG_FORMAT = "json";
process.env.LOG_MCP_PROTOCOL = "true";

const { logInboundMcpProtocol, logOutboundMcpProtocol } = await import("../src/logging/mcp-protocol-log.js");

const API_KEY = "super_secret_api_key_1234";
let lines: string[] = [];

beforeEach(() => {
  lines = [];
  mock.method(console, "log", (line: string) => {
    lines.push(line);
  });
});

afterEach(() => {
  mock.restoreAll();
});

describe("logInboundMcpProtocol (LOG_FORMAT=json)", () => {
  it("redacts sensitive request headers", () => {
    logInboundMcpProtocol(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      {
        authorization: `Bearer ${API_KEY}`,
        "x-shortpixel-api-key": API_KEY,
        cookie: "session=abc123",
        "content-type": "application/json",
      },
    );

    assert.equal(lines.length, 1);
    assert.ok(!lines[0]!.includes(API_KEY));
    assert.ok(!lines[0]!.includes("session=abc123"));

    const entry = JSON.parse(lines[0]!);
    assert.deepEqual(entry.headers, {
      authorization: "Bearer ****1234",
      "x-shortpixel-api-key": "****1234",
      cookie: "****",
      "content-type": "application/json",
    });
  });
});

describe("logOutboundMcpProtocol (LOG_FORMAT=json)", () => {
  it("redacts sensitive response headers", () => {
    logOutboundMcpProtocol(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 1, result: { tools: [] } },
      200,
      { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    );

    assert.equal(lines.length, 1);
    assert.ok(!lines[0]!.includes(API_KEY));

    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.headers.authorization, "Bearer ****1234");
    assert.equal(entry.headers["content-type"], "application/json");
  });
});
