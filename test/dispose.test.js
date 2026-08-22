/**
 * Offline tests for runtime teardown: the plugin's dispose hook must kill the
 * cached wallet-armed server session (closeWriteSession) so no child process
 * outlives its runtime, must evict the cache so a later action respawns
 * cleanly, and must be a safe no-op when the write tier never spawned or its
 * bootstrap failed. No child processes here; transports are in-process fakes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "../src/index.js";
import { McpClient } from "../src/lib/mcp-client.js";
import { closeWriteSession, getWriteClient } from "../src/lib/write-client.js";

const runtimeWith = (settings = {}) => ({ getSetting: (k) => settings[k] });

/** In-process transport that answers the initialize handshake and records
 *  close() calls into `closes`. */
function fakeTransport(closes) {
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
    close() {
      closes.push("closed");
    },
  };
}

test("dispose closes the cached session's transport and evicts the cache", async () => {
  const runtime = runtimeWith();
  const closes = [];
  let spawns = 0;
  const connect = async () => {
    spawns += 1;
    const client = new McpClient(fakeTransport(closes));
    await client.connect();
    return client;
  };

  const first = await getWriteClient(runtime, connect);
  assert.equal(await getWriteClient(runtime, connect), first, "session is cached per runtime");
  assert.equal(spawns, 1);

  assert.equal(await closeWriteSession(runtime), true);
  assert.deepEqual(closes, ["closed"], "teardown must reach the transport's close()");
  await assert.rejects(first.listTools(), /client closed/, "the old client is dead");

  const second = await getWriteClient(runtime, connect);
  assert.notEqual(second, first, "after teardown the next action gets a fresh session");
  assert.equal(spawns, 2);
});

test("dispose is a no-op when the write tier never spawned", async () => {
  assert.equal(await closeWriteSession(runtimeWith()), false);
});

test("dispose after a failed bootstrap does not throw and reports nothing to close", async () => {
  const runtime = runtimeWith();
  const connect = async () => {
    throw new Error("spawn failed");
  };
  await assert.rejects(getWriteClient(runtime, connect), /spawn failed/);
  assert.equal(await closeWriteSession(runtime), false);
});

test("the plugin object wires dispose to the session teardown", async () => {
  assert.equal(typeof plugin.dispose, "function");
  const runtime = runtimeWith();
  const closes = [];
  const connect = async () => {
    const client = new McpClient(fakeTransport(closes));
    await client.connect();
    return client;
  };
  await getWriteClient(runtime, connect);
  await plugin.dispose(runtime);
  assert.deepEqual(closes, ["closed"], "plugin.dispose must close the cached session");
  // And on a runtime with no session it resolves quietly.
  await plugin.dispose(runtimeWith());
});
