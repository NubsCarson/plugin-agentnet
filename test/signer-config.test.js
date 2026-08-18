/**
 * Offline tests for AGENTNET_SIGNER selection: keyfile default stays
 * byte-identical, steward mode validates its config and honestly reports
 * "waiting on upstream signer hook" (zero spawns) until the operator asserts
 * a hook-capable server build, a hook-asserted steward config swaps the
 * keyfile for AGENTNET_WALLET_REMOTE in the spawn env, and the live custody
 * probe fails closed: a dead or lying bridge means no spawn and no keyfile,
 * ever. All servers here are in-process on 127.0.0.1.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { test } from "node:test";
import { createWriteTierActions } from "../src/actions/write-tier.js";
import { probeStewardBridge, resolveSigner, WAITING_ON_UPSTREAM } from "../src/lib/signer.js";
import { getWriteClient, mcpSpawnConfig, spawnConnect } from "../src/lib/write-client.js";

const runtimeWith = (settings = {}) => ({ getSetting: (k) => settings[k] });
const BRIDGE_URL = "http://127.0.0.1:8177";
const ADDRESS = "3BpjjjJujk6qsG6rRLdiR3Wfsgh3SdhyJ83W46VUyc3Q";

/** In-process stub bridge; `reply(req, res)` shapes the /pubkey answer. */
async function withStubBridge(reply, run) {
  const server = createServer(reply);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** A loopback URL where nothing listens: bind port 0, note it, close. */
async function deadUrl() {
  const server = createTcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

/** Transport that never spawns: records the spawn config and answers the MCP
 *  initialize handshake in-process. */
function fakeServerTransport(spawned) {
  return (cfg) => {
    spawned.push(cfg);
    let deliver;
    return {
      start(onMessage) {
        deliver = onMessage;
      },
      send(msg) {
        if (msg.method === "initialize") {
          queueMicrotask(() =>
            deliver({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "fake" } } }),
          );
        }
      },
      close() {},
    };
  };
}

const stewardSettings = (url) => ({
  AGENTNET_SIGNER: "steward",
  AGENTNET_STEWARD_SIGNER_URL: url,
  AGENTNET_SIGNER_HOOK: "1",
  AGENTNET_WALLET_KEYFILE: "/tmp/key.json",
  AGENTNET_MCP_COMMAND: "node /pinned/patched-agentnet-mcp.js",
});

test("default signer is keyfile and the spawn env is unchanged", () => {
  const runtime = runtimeWith({ AGENTNET_WALLET_KEYFILE: "/tmp/key.json" });
  assert.deepEqual(resolveSigner(runtime), { ok: true, mode: "keyfile", ready: true });
  const cfg = mcpSpawnConfig(runtime);
  assert.equal(cfg.env.AGENTNET_WALLET_KEYFILE, "/tmp/key.json");
  assert.equal(cfg.env.AGENTNET_WALLET_REMOTE, undefined);
  assert.equal(cfg.env.AGENTNET_MCP_READONLY, "0");
});

test("unknown AGENTNET_SIGNER fails closed naming the setting", () => {
  const runtime = runtimeWith({ AGENTNET_SIGNER: "phantom" });
  const resolved = resolveSigner(runtime);
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /AGENTNET_SIGNER/);
  assert.throws(() => mcpSpawnConfig(runtime), /AGENTNET_SIGNER/);
});

test("steward without a bridge URL is invalid config, not a silent keyfile fallback", () => {
  const runtime = runtimeWith({ AGENTNET_SIGNER: "steward" });
  const resolved = resolveSigner(runtime);
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /AGENTNET_STEWARD_SIGNER_URL/);
  assert.throws(() => mcpSpawnConfig(runtime), /AGENTNET_STEWARD_SIGNER_URL/);
});

test("steward with a junk URL is invalid config", () => {
  const runtime = runtimeWith({
    AGENTNET_SIGNER: "steward",
    AGENTNET_STEWARD_SIGNER_URL: "not a url",
  });
  const resolved = resolveSigner(runtime);
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /not a valid URL/);
});

test("steward config validates but reports waiting on the upstream hook", () => {
  const runtime = runtimeWith({
    AGENTNET_SIGNER: "steward",
    AGENTNET_STEWARD_SIGNER_URL: BRIDGE_URL,
  });
  const resolved = resolveSigner(runtime);
  assert.equal(resolved.ok, true, "config itself is valid");
  assert.equal(resolved.mode, "steward");
  assert.equal(resolved.ready, false);
  assert.match(resolved.reason, /waiting on upstream signer hook/);
  assert.equal(resolved.reason, WAITING_ON_UPSTREAM);
  assert.throws(() => mcpSpawnConfig(runtime), /waiting on upstream signer hook/);
});

test("blocked steward: write action reports the reason and spawns nothing", async () => {
  const runtime = runtimeWith({
    AGENTNET_ALLOW_WRITES: "true",
    AGENTNET_SIGNER: "steward",
    AGENTNET_STEWARD_SIGNER_URL: BRIDGE_URL,
  });
  const spawns = [];
  // Mirrors spawnConnect's real composition: config resolves BEFORE any spawn.
  const connect = async (rt) => {
    const cfg = mcpSpawnConfig(rt);
    spawns.push(cfg);
    throw new Error("must not reach the spawn");
  };
  const actions = createWriteTierActions({ getClient: (rt) => getWriteClient(rt, connect) });
  const blog = actions.find((a) => a.name === "POST_AGENTNET_BLOG");
  const result = await blog.handler(
    runtime,
    { content: { text: "post an agentnet blog: hi" } },
    undefined,
    { text: "hello chain" },
    undefined,
  );
  assert.equal(result.success, false);
  assert.match(result.text, /waiting on upstream signer hook/);
  assert.equal(spawns.length, 0, "a blocked signer must never produce a spawn config");
});

test("steward + dead URL: no spawn, no keyfile fallback, honest refusal", async () => {
  const runtime = runtimeWith(stewardSettings(await deadUrl()));
  const spawned = [];
  await assert.rejects(
    spawnConnect(runtime, { makeTransport: fakeServerTransport(spawned) }),
    /no Steward signer bridge answered GET .*\/pubkey/,
  );
  assert.equal(spawned.length, 0, "a dead bridge must never reach a spawn");
  // Even the config that was built (and discarded) never carries the keyfile.
  const cfg = mcpSpawnConfig(runtime);
  assert.equal(cfg.env.AGENTNET_WALLET_KEYFILE, undefined, "steward mode forwards no keyfile");
});

test("steward + dead URL through the write action: honest copy, zero spawns", async () => {
  const url = await deadUrl();
  const runtime = runtimeWith({ AGENTNET_ALLOW_WRITES: "true", ...stewardSettings(url) });
  const spawned = [];
  const connect = (rt) => spawnConnect(rt, { makeTransport: fakeServerTransport(spawned) });
  const actions = createWriteTierActions({ getClient: (rt) => getWriteClient(rt, connect) });
  const blog = actions.find((a) => a.name === "POST_AGENTNET_BLOG");
  const result = await blog.handler(
    runtime,
    { content: { text: "post an agentnet blog: hi" } },
    undefined,
    { text: "hello chain" },
    undefined,
  );
  assert.equal(result.success, false);
  assert.match(result.text, /no Steward signer bridge answered/);
  assert.match(result.text, /never falls back to a local keyfile/);
  assert.equal(spawned.length, 0, "refusal must reach zero spawns");
});

test("probe fails closed on a refusing bridge (401) and on a lying one (no address)", async () => {
  await withStubBridge(
    (_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "shared-secret header required" }));
    },
    async (url) => {
      const probe = await probeStewardBridge(url);
      assert.equal(probe.ok, false);
      assert.match(probe.error, /HTTP 401/);
    },
  );
  await withStubBridge(
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ nope: true }));
    },
    async (url) => {
      const probe = await probeStewardBridge(url);
      assert.equal(probe.ok, false);
      assert.match(probe.error, /no "address"/);
    },
  );
});

test("steward + live bridge: probe passes and the session arms with the remote, no keyfile", async () => {
  await withStubBridge(
    (req, res) => {
      assert.equal(req.url, "/pubkey");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ address: ADDRESS }));
    },
    async (url) => {
      const probe = await probeStewardBridge(url);
      assert.deepEqual(probe, { ok: true, address: ADDRESS });

      const runtime = runtimeWith(stewardSettings(url));
      const spawned = [];
      const client = await spawnConnect(runtime, { makeTransport: fakeServerTransport(spawned) });
      assert.equal(spawned.length, 1, "a live bridge spawns exactly one session");
      assert.equal(spawned[0].env.AGENTNET_WALLET_REMOTE, url);
      assert.equal(
        spawned[0].env.AGENTNET_WALLET_KEYFILE,
        undefined,
        "the forwarded env must never carry a keyfile in steward mode",
      );
      client.close();
    },
  );
});

test("hook asserted: spawn env carries AGENTNET_WALLET_REMOTE and drops the keyfile", () => {
  const runtime = runtimeWith({
    AGENTNET_SIGNER: "steward",
    AGENTNET_STEWARD_SIGNER_URL: BRIDGE_URL,
    AGENTNET_SIGNER_HOOK: "1",
    AGENTNET_WALLET_KEYFILE: "/tmp/key.json",
    AGENTNET_MCP_COMMAND: "node /pinned/patched-agentnet-mcp.js",
  });
  const resolved = resolveSigner(runtime);
  assert.deepEqual(resolved, { ok: true, mode: "steward", ready: true, url: BRIDGE_URL });
  const cfg = mcpSpawnConfig(runtime);
  assert.equal(cfg.command, "node");
  assert.deepEqual(cfg.args, ["/pinned/patched-agentnet-mcp.js"]);
  assert.equal(cfg.env.AGENTNET_WALLET_REMOTE, BRIDGE_URL);
  assert.equal(
    cfg.env.AGENTNET_WALLET_KEYFILE,
    undefined,
    "steward mode must not arm the local keyfile",
  );
});
