import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAuthRequiredForMcpMethod,
  readMcpMethod,
} from "../src/http/mcp-auth.js";

describe("readMcpMethod", () => {
  it("extracts method from a valid JSON-RPC body", () => {
    assert.equal(readMcpMethod({ method: "tools/call", id: 1 }), "tools/call");
  });

  it("returns undefined for non-object bodies", () => {
    assert.equal(readMcpMethod(null), undefined);
    assert.equal(readMcpMethod("tools/list"), undefined);
    assert.equal(readMcpMethod([]), undefined);
  });

  it("returns undefined when method is not a string", () => {
    assert.equal(readMcpMethod({ method: 42 }), undefined);
    assert.equal(readMcpMethod({}), undefined);
  });
});

describe("isAuthRequiredForMcpMethod", () => {
  it("does not require auth for initialize (MCP handshake)", () => {
    assert.equal(isAuthRequiredForMcpMethod("initialize"), false);
  });

  it("does not require auth for tools/list (tool discovery)", () => {
    assert.equal(isAuthRequiredForMcpMethod("tools/list"), false);
  });

  it("requires auth for tools/call", () => {
    assert.equal(isAuthRequiredForMcpMethod("tools/call"), true);
  });

  it("requires auth when method is missing (safe default)", () => {
    assert.equal(isAuthRequiredForMcpMethod(undefined), true);
  });

  it("requires auth for unknown methods", () => {
    assert.equal(isAuthRequiredForMcpMethod("notifications/initialized"), true);
  });
});
