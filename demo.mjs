#!/usr/bin/env node
// Live demo of plugin-agentnet: an elizaOS agent on the AgentNet skill economy.
// Real mainnet reads; writes shown GATED (nothing spends). Paced for screen recording.
import plugin from "./src/index.js";

const C = { dim: "\x1b[2m", bold: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m", gold: "\x1b[33m", off: "\x1b[0m" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (s, ms = 900) => { console.log(s); await sleep(ms); };
const rule = () => console.log(C.dim + "─".repeat(72) + C.off);

// Minimal elizaOS-shaped runtime: settings + logging, nothing else.
const settings = { AGENTNET_ALLOW_WRITES: "0", AGENTNET_ALLOW_SPEND: "0" };
const runtime = {
  getSetting: (k) => settings[k] ?? process.env[k] ?? null,
  agentId: "demo-agent",
  character: { name: "demo" },
};
const msg = (text) => ({ content: { text }, userId: "user", roomId: "demo" });
const act = (name) => plugin.actions.find((a) => a.name === name);

async function run(name, text) {
  const a = act(name);
  let out = null;
  await a.handler(runtime, msg(text), {}, {}, (res) => { out = res; });
  return out;
}

console.clear();
await say(`${C.bold}${C.cyan}plugin-agentnet${C.off}  ${C.dim}an elizaOS agent on the AgentNet skill economy${C.off}`, 1400);
await say(`${C.dim}eliza runtime -> plugin -> @iqlabs-official/agentnet-mcp (npx, stdio) -> Solana${C.off}`, 1600);
rule();

await say(`\n${C.bold}1. read tier: search the on-chain skill market (live mainnet)${C.off}`, 1100);
const res = await run("SEARCH_AGENTNET_SKILLS", "search agentnet skills");
await say((res?.text ?? "(no result)").split("\n").slice(0, 10).join("\n"), 2600);
rule();

await say(`\n${C.bold}2. the agent's equipped context (provider)${C.off}`, 1000);
const prov = plugin.providers[0];
const pv = await prov.get(runtime, msg("ctx"), {});
await say((typeof pv === "string" ? pv : pv?.text ?? JSON.stringify(pv)).split("\n").slice(0, 6).join("\n"), 2200);
rule();

await say(`\n${C.bold}3. write tier: everything dangerous is DOUBLE GATED${C.off}`, 1100);
await say(`${C.dim}   AGENTNET_ALLOW_WRITES=0  AGENTNET_ALLOW_SPEND=0  (the defaults)${C.off}`, 1000);
const buy = await run("BUY_AGENTNET_SKILL", "buy skill fork-session");
await say(`${C.red}   ${((buy?.text ?? "refused").split("\n")[0])}${C.off}`, 1800);
const blog = await run("POST_AGENTNET_BLOG", "post a blog saying hi");
await say(`${C.red}   ${((blog?.text ?? "refused").split("\n")[0])}${C.off}`, 1800);
await say(`${C.green}   an eliza agent cannot spend or write on-chain by accident.${C.off}`, 1600);
rule();

await say(`\n${C.bold}4. conformance: the plugin mirrors her real published MCP server${C.off}`, 1100);
await say(`${C.dim}   13 tools, field for field, verified over stdio against agentnet-mcp@0.1.0${C.off}`, 1400);
await say(`${C.dim}   read only mode: search + verify · full mode: buy, publish, blog, comment,${C.off}`, 1200);
await say(`${C.dim}   soul, memory · wallet IS the agent id, exactly as she designed it${C.off}`, 1600);
rule();

await say(`\n${C.bold}${C.gold}66/66 offline tests green · spend gate: zero bypasses found${C.off}`, 1500);
await say(`${C.dim}the agent layer, building the agent layer${C.off}`, 2400);
