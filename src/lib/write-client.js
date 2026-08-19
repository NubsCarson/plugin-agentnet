/**
 * Write-tier gating and server session management. The write tier fronts the
 * published @iqlabs-official/agentnet-mcp server in FULL mode (a wallet-armed
 * process), so it is double-gated in config, both defaulting OFF:
 *
 *   AGENTNET_ALLOW_WRITES  spawn the wallet session at all (vault reads,
 *                          on-chain posts, installs)
 *   AGENTNET_ALLOW_SPEND   additionally required for tools that move value
 *                          (buy_skill, publish_skill)
 *
 * One server process per runtime, cached: the server's verify-before-buy
 * guard is per-process session state, so verify and buy must land on the
 * same process, and reusing it keeps npx spawns to one.
 *
 * AGENTNET_SIGNER (lib/signer.js) picks where the server's key lives:
 * "keyfile" (default, unchanged) or "steward" (remote policy vault; blocked
 * until the upstream server ships its remote signer hook, and additionally
 * gated on a live GET /pubkey probe of the bridge before any spawn).
 */
import { agentnetConfig } from "./indexer.js";
import { AGENTNET_MCP_PACKAGE, McpClient, StdioProcTransport } from "./mcp-client.js";
import { flagTrue as flag, probeStewardBridge, resolveSigner } from "./signer.js";

export function writesAllowed(runtime) {
  return flag(runtime?.getSetting?.("AGENTNET_ALLOW_WRITES"));
}

export function spendAllowed(runtime) {
  return flag(runtime?.getSetting?.("AGENTNET_ALLOW_SPEND"));
}

/** Env vars forwarded verbatim to the spawned server when set. */
const FORWARDED_SETTINGS = [
  "AGENTNET_WALLET_KEYFILE",
  "AGENTNET_WALLET_REMOTE_TOKEN",
  "AGENTNET_NETWORK",
  "AGENTNET_HOME",
  "AGENTNET_ELIZA_CHARACTER",
  "AGENTNET_GATEWAY_URL",
  "AGENTNET_INDEXER_URL",
];

/** Spawn config for the server process. AGENTNET_MCP_COMMAND overrides the
 *  whole command line (whitespace-split, no shell quoting), e.g.
 *  "node /path/to/agentnet-mcp.js" for a pinned local build.
 *
 *  Throws (before any spawn) when the signer config is invalid or when
 *  AGENTNET_SIGNER=steward is configured but the target server build has no
 *  remote signer hook yet; the write action reports the thrown reason. */
export function mcpSpawnConfig(runtime) {
  const get = (k) => runtime?.getSetting?.(k);
  const signer = resolveSigner(runtime);
  if (!signer.ok) throw new Error(`agentnet signer config: ${signer.error}`);
  if (!signer.ready) throw new Error(`agentnet write tier unavailable: ${signer.reason}`);
  const commandLine = String(get("AGENTNET_MCP_COMMAND") || `npx -y ${AGENTNET_MCP_PACKAGE}`);
  const [command, ...args] = commandLine.split(/\s+/).filter(Boolean);
  const env = { AGENTNET_MCP_READONLY: "0" };
  for (const key of FORWARDED_SETTINGS) {
    // Steward mode means "no locally armed key": the keyfile is never
    // forwarded; the server signs through the remote endpoint instead.
    if (signer.mode === "steward" && key === "AGENTNET_WALLET_KEYFILE") continue;
    const val = get(key);
    if (val) env[key] = String(val);
  }
  if (signer.mode === "steward") env.AGENTNET_WALLET_REMOTE = signer.url;
  // Bought skills should land where the eliza skills loader scans, on top of
  // whatever extra dirs the operator already forwards.
  const { skillsDir } = agentnetConfig(runtime);
  const extraDirs = String(get("AGENTNET_SKILL_DIRS") ?? "");
  env.AGENTNET_SKILL_DIRS = extraDirs ? `${extraDirs},${skillsDir}` : skillsDir;
  return { command, args, env };
}

/** Real session bootstrap: resolve and validate the spawn config, run the
 *  steward custody probe when steward mode is armed, then spawn and
 *  handshake. Order matters and is what the negative tests pin: config
 *  errors, the blocked-hook refusal, and a dead bridge all throw BEFORE
 *  `makeTransport` runs, so nothing is ever spawned (and in steward mode no
 *  keyfile is ever forwarded) on a failed gate. `makeTransport` and
 *  `fetchImpl` are injectable for tests only. */
export async function spawnConnect(
  runtime,
  { makeTransport = (cfg) => new StdioProcTransport(cfg), fetchImpl } = {},
) {
  const cfg = mcpSpawnConfig(runtime);
  const signer = resolveSigner(runtime);
  if (signer.mode === "steward") {
    const probe = await probeStewardBridge(signer.url, fetchImpl, signer.token);
    if (!probe.ok) throw new Error(`agentnet write tier unavailable: ${probe.error}`);
  }
  const client = new McpClient(makeTransport(cfg));
  await client.connect();
  return client;
}

const sessions = new WeakMap(); // runtime -> Promise<McpClient>

/** Connected client for this runtime, spawning the server on first use.
 *  `connect` is injectable for tests. Dead sessions self-evict so the next
 *  call respawns. */
export function getWriteClient(runtime, connect = spawnConnect) {
  let entry = sessions.get(runtime);
  if (!entry) {
    entry = connect(runtime).then((client) => {
      client.onClose = () => sessions.delete(runtime);
      return client;
    });
    entry.catch(() => sessions.delete(runtime));
    sessions.set(runtime, entry);
  }
  return entry;
}
