/**
 * Offline protocol tests for the minimal MCP stdio client against an
 * in-process fake transport: initialize handshake order, tools/call
 * serialization, JSON-RPC error propagation, and pending-request rejection
 * on close.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { McpClient, MCP_PROTOCOL_VERSION } from "../src/lib/mcp-client.js";

class FakeTransport {
  sent = [];
  constructor(respond) {
    this.respond = respond;
  }
  start(onMessage, onClose) {
    this.onMessage = onMessage;
    this.onClose = onClose;
  }
  send(msg) {
    this.sent.push(msg);
    if (msg.id === undefined) return; // notification: nothing comes back
    const reply = this.respond?.(msg);
    if (reply) queueMicrotask(() => this.onMessage(reply));
  }
  close() {
    this.closed = true;
  }
}

const defaultRespond = (msg) => {
  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "agentnet-marketplace", version: "0.0.1" },
      },
    };
  }
  if (msg.method === "tools/list") {
    return { jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "search_skills" }, { name: "verify_skill" }] } };
  }
  if (msg.method === "tools/call") {
    return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `ran ${msg.params.name}` }] } };
  }
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } };
};

test("connect runs the MCP handshake in order and records serverInfo", async () => {
  const t = new FakeTransport(defaultRespond);
  const client = new McpClient(t);
  await client.connect();
  assert.equal(t.sent[0].method, "initialize");
  assert.equal(t.sent[0].params.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(t.sent[1].method, "notifications/initialized");
  assert.equal(t.sent[1].id, undefined, "initialized must be a notification");
  assert.equal(client.serverInfo.name, "agentnet-marketplace");
});

test("listTools and callTool serialize per the tools/* protocol", async () => {
  const t = new FakeTransport(defaultRespond);
  const client = new McpClient(t);
  await client.connect();
  const tools = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name), ["search_skills", "verify_skill"]);
  const res = await client.callTool("verify_skill", { skillId: "abc" });
  assert.equal(res.content[0].text, "ran verify_skill");
  const call = t.sent.find((m) => m.method === "tools/call");
  assert.deepEqual(call.params, { name: "verify_skill", arguments: { skillId: "abc" } });
});

test("JSON-RPC error responses reject the request", async () => {
  const t = new FakeTransport(defaultRespond);
  const client = new McpClient(t);
  await client.connect();
  await assert.rejects(() => client.request("nope"), /-32601|method not found/);
});

test("close rejects in-flight requests and refuses new ones", async () => {
  const t = new FakeTransport((msg) => (msg.method === "initialize" ? defaultRespond(msg) : null));
  const client = new McpClient(t);
  await client.connect();
  const closed = [];
  client.onClose = (err) => closed.push(err);
  const pending = client.request("tools/list");
  client.close();
  await assert.rejects(() => pending, /closed/);
  await assert.rejects(() => client.request("tools/list"), /closed/);
  assert.equal(closed.length, 1, "onClose fires exactly once");
  assert.equal(t.closed, true, "transport is closed");
});
