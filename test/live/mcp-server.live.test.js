/**
 * Live conformance test: spawn the REAL published @iqlabs-official/agentnet-mcp
 * server (npx, stdio) with the plugin's own transport and client, and check
 * our mirrored tool table against its tools/list. Everything is isolated in
 * a per-run tmp home (throwaway generated keypair, no funds); the default
 * read-only mode and full mode both sign nothing and write nothing on-chain
 * here, since only list/initialize are called. Run via `npm run test:live`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { McpClient, StdioProcTransport } from "../../src/lib/mcp-client.js";
import { MCP_TOOLS, SERVER_READ_ONLY_TOOLS } from "../../src/lib/mcp-tools.js";

const home = mkdtempSync(join(tmpdir(), "agentnet-mcp-live-"));
after(() => rmSync(home, { recursive: true, force: true }));

// Isolate every path the server might touch; the keypair is generated fresh
// in tmp and never funded.
const isolatedEnv = (readonlyFlag) => ({
  AGENTNET_WALLET_KEYFILE: join(home, "wallet.json"),
  AGENTNET_HOME: home,
  CLAUDE_CONFIG_DIR: join(home, "claude"),
  CODEX_HOME: join(home, "codex"),
  HERMES_HOME: join(home, "hermes"),
  OPENCLAW_HOME: join(home, "openclaw"),
  AGENTNET_MCP_READONLY: readonlyFlag,
});

async function withServer(readonlyFlag, fn) {
  const client = new McpClient(new StdioProcTransport({ env: isolatedEnv(readonlyFlag) }), {
    timeoutMs: 150_000,
  });
  try {
    await client.connect();
    await fn(client);
  } finally {
    client.close();
  }
}

/** The listed schema must match our mirror: same required set, and no
 *  property we do not know about (unknown props would mean the published
 *  surface grew past the plugin). */
function assertSchemaConforms(tool) {
  const mirror = MCP_TOOLS[tool.name];
  assert.ok(mirror, `server lists ${tool.name}, missing from our mirror`);
  const required = (tool.inputSchema?.required ?? []).sort();
  const mirrorRequired = Object.entries(mirror.fields)
    .filter(([, f]) => f.required)
    .map(([k]) => k)
    .sort();
  assert.deepEqual(required, mirrorRequired, `${tool.name}: required fields drifted`);
  for (const prop of Object.keys(tool.inputSchema?.properties ?? {})) {
    assert.ok(prop in mirror.fields, `${tool.name}: server has unmapped property "${prop}"`);
  }
}

test("live: default read-only mode exposes exactly the read tools", async () => {
  await withServer("", async (client) => {
    assert.equal(client.serverInfo?.name, "agentnet-marketplace");
    const tools = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      [...SERVER_READ_ONLY_TOOLS].sort(),
      "read-only surface changed",
    );
    tools.forEach(assertSchemaConforms);
  });
});

test("live: full mode lists every tool in our mirror with conforming schemas", async () => {
  await withServer("0", async (client) => {
    const tools = await client.listTools();
    const listed = tools.map((t) => t.name).sort();
    // The 9 marketplace tools are unconditional in full mode; the 4 vault
    // tools require the vault to come up (it does with local storage, but a
    // login failure degrades gracefully), so assert marketplace exactly and
    // vault as all-or-nothing.
    const marketplace = Object.keys(MCP_TOOLS).filter((n) => !n.startsWith("soul_") && !n.startsWith("memory_"));
    const vault = Object.keys(MCP_TOOLS).filter((n) => n.startsWith("soul_") || n.startsWith("memory_"));
    for (const name of marketplace) assert.ok(listed.includes(name), `full mode missing ${name}`);
    const vaultListed = vault.filter((n) => listed.includes(n));
    assert.ok(
      vaultListed.length === 0 || vaultListed.length === vault.length,
      `vault tools partially listed: ${vaultListed.join(", ")}`,
    );
    for (const name of listed) assert.ok(name in MCP_TOOLS, `server grew an unmapped tool: ${name}`);
    tools.forEach(assertSchemaConforms);
  });
});
