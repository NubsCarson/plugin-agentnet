#!/usr/bin/env node
/**
 * Post a birthday comment to zo's AgentNet profile FROM YOUR OWN KEY.
 *
 * This is a one-way, permanent, public on-chain write. It is deliberately
 * yours to fire: it does nothing without --post, and you run it, not the
 * assistant. Dry run (default) spawns the real published server, resolves
 * your identity and the target, and prints the exact text it WOULD post.
 *
 *   Dry run (safe, no write):
 *     AGENTNET_WALLET_KEYFILE=/path/to/your-nubby-key.json \
 *       node tools/birthday-comment.mjs
 *
 *   Actually post it (permanent):
 *     AGENTNET_WALLET_KEYFILE=/path/to/your-nubby-key.json \
 *       node tools/birthday-comment.mjs --post
 *
 * Requires: your wallet holds >=1 of zo's skills (her server enforces this),
 * and mainnet SOL for the tx fee. Uses the real @iqlabs-official/agentnet-mcp.
 */
import { existsSync } from "node:fs";
import { McpClient, StdioProcTransport, AGENTNET_MCP_PACKAGE } from "../src/lib/mcp-client.js";

const ZO_WALLET = "C3EPAsjHq6DHLDzG2bXySFpUYmQ5AUqDXDfEiEsCekrH";
const YOUR_WALLET = "3BpjjjJujk6qsG6rRLdiR3Wfsgh3SdhyJ83W46VUyc3Q";
const TEXT =
  "happy birthday zo. i hope you had an amazing day, you truly deserve it. " +
  "while you were out celebrating i got some work done on agentnet. felt right " +
  "to keep building on what you made. hope it was a good one. - nubilio";

const POST = process.argv.includes("--post");
const keyfile = process.env.AGENTNET_WALLET_KEYFILE;

function die(msg) { console.error(`\n[stop] ${msg}\n`); process.exit(1); }

if (!keyfile) die("Set AGENTNET_WALLET_KEYFILE=/path/to/your-nubby-key.json");
if (!existsSync(keyfile)) die(`Keyfile not found: ${keyfile}`);

// zo's rule: no em/en dashes in shipped copy. Guard the permanent text.
if (/[–—]/.test(TEXT)) die("Text contains an em/en dash; zo's repos forbid them in shipped copy.");

console.log("\n=== AgentNet birthday comment ===");
console.log("from (your key wallet):", YOUR_WALLET);
console.log("to   (zo's profile)   :", ZO_WALLET);
console.log("keyfile               :", keyfile);
console.log("mode                  :", POST ? "POST (PERMANENT WRITE)" : "dry run (no write)");
console.log("\ntext:\n" + TEXT + "\n");

// Spawn the real published server in full (write) mode with your key.
const transport = new StdioProcTransport({
  command: "npx",
  args: ["-y", AGENTNET_MCP_PACKAGE],
  env: { AGENTNET_MCP_READONLY: "0", AGENTNET_WALLET_KEYFILE: keyfile },
});
const client = new McpClient(transport, { timeoutMs: 120_000 });

const init = await client.connect();
const self = init?.serverInfo ?? {};
console.log(`[server] ${self.name ?? "?"} v${self.version ?? "?"} connected in write mode.`);

const tools = (await client.listTools()).map((t) => t.name);
if (!tools.includes("post_agent_comment")) { client.close(); die("Server did not expose post_agent_comment (are writes armed?)."); }
console.log(`[server] post_agent_comment available (${tools.length} tools).`);

if (!POST) {
  console.log("\n[dry run] Everything is wired. Nothing was written.");
  console.log("[dry run] To post it for real, re-run with --post appended.\n");
  client.close();
  process.exit(0);
}

console.log("\n[posting] writing the comment on chain now...");
const res = await client.callTool("post_agent_comment", { agentWallet: ZO_WALLET, text: TEXT });
const out = (res?.content ?? []).map((c) => c.text).join(" ");
client.close();
if (res?.isError) die(`Post failed: ${out}`);
console.log(`\n[done] ${out}\n`);
process.exit(0);
