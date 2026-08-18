/**
 * Write-tier signer selection. AGENTNET_SIGNER picks where the spawned
 * agentnet-mcp server's signing key lives:
 *
 *   "keyfile" (default)  the server loads/creates the Solana keypair file
 *                        (AGENTNET_WALLET_KEYFILE). Today's behavior, unchanged.
 *   "steward"            route signing through a Steward policy vault via the
 *                        vault's loopback signer bridge (@stwd/solana-signer
 *                        startSignerBridge). Requires AGENTNET_STEWARD_SIGNER_URL,
 *                        and the spawned server build must support the
 *                        AGENTNET_WALLET_REMOTE hook.
 *
 * HONESTY GATE, two halves, both required before steward mode arms anything:
 *
 *   1. Assertion: the published @iqlabs-official/agentnet-mcp server does NOT
 *      expose the remote signer hook yet (it is a drafted upstream patch), so
 *      steward mode stays BLOCKED, reporting "waiting on upstream signer
 *      hook", until the operator asserts a hook-capable build with
 *      AGENTNET_SIGNER_HOOK=1 (for example a pinned AGENTNET_MCP_COMMAND
 *      running the patched build).
 *   2. Live probe (probeStewardBridge): the assertion alone proves nothing
 *      about the operator's machine, so at session start, before any server
 *      spawn, the write tier GETs {url}/pubkey on the bridge and refuses
 *      unless a signer actually answers with an address.
 *
 * Both halves refuse rather than fall back to the keyfile: an operator who
 * chose steward chose "no locally armed key", so steward mode never forwards
 * AGENTNET_WALLET_KEYFILE and never spawns on a dead bridge.
 */

const TRUE_RE = /^\s*(1|true|yes|on)\s*$/i;

/** One source of truth for boolean-ish settings ("1", "true", "yes", "on"). */
export function flagTrue(value) {
  return TRUE_RE.test(String(value ?? ""));
}

export const WAITING_ON_UPSTREAM =
  "waiting on upstream signer hook: the published @iqlabs-official/agentnet-mcp server does not " +
  "expose AGENTNET_WALLET_REMOTE yet. Point AGENTNET_MCP_COMMAND at a build that ships the hook " +
  "and set AGENTNET_SIGNER_HOOK=1 to enable steward signing.";

/**
 * Resolve the signer choice from runtime settings.
 * Returns one of:
 *   { ok: true,  mode: "keyfile", ready: true }
 *   { ok: true,  mode: "steward", ready: true,  url }
 *   { ok: true,  mode: "steward", ready: false, url, reason }   valid config, blocked on upstream
 *   { ok: false, error }                                        invalid config, names the setting
 */
export function resolveSigner(runtime) {
  const get = (k) => (runtime && runtime.getSetting ? runtime.getSetting(k) : undefined);
  const mode = String(get("AGENTNET_SIGNER") || "keyfile")
    .trim()
    .toLowerCase();

  if (mode === "keyfile") return { ok: true, mode: "keyfile", ready: true };
  if (mode !== "steward") {
    return {
      ok: false,
      error: `AGENTNET_SIGNER must be "keyfile" or "steward", got "${mode}"`,
    };
  }

  const url = String(get("AGENTNET_STEWARD_SIGNER_URL") || "").trim();
  if (!url) {
    return {
      ok: false,
      error:
        "AGENTNET_SIGNER=steward requires AGENTNET_STEWARD_SIGNER_URL " +
        "(the loopback URL of a running Steward signer bridge, e.g. http://127.0.0.1:8177)",
    };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `AGENTNET_STEWARD_SIGNER_URL is not a valid URL: "${url}"` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: `AGENTNET_STEWARD_SIGNER_URL must be http(s), got "${parsed.protocol}"`,
    };
  }

  if (!flagTrue(get("AGENTNET_SIGNER_HOOK"))) {
    return { ok: true, mode: "steward", ready: false, url, reason: WAITING_ON_UPSTREAM };
  }
  return { ok: true, mode: "steward", ready: true, url };
}

/**
 * Live half of the custody gate, run at session start before any server
 * spawn: GET {url}/pubkey on the Steward signer bridge. AGENTNET_SIGNER_HOOK
 * only asserts the server BUILD understands AGENTNET_WALLET_REMOTE; this
 * probe checks a bridge is genuinely answering, so a mis-asserted hook can
 * never drift into arming a local key. Returns { ok: true, address } or
 * { ok: false, error } with copy naming the URL and the failure.
 * `fetchImpl` is injectable for tests.
 */
export async function probeStewardBridge(url, fetchImpl = globalThis.fetch) {
  const base = String(url).replace(/\/+$/, "");
  const refuse = (detail) => ({
    ok: false,
    error:
      `no Steward signer bridge answered GET ${base}/pubkey (${detail}). ` +
      "AGENTNET_SIGNER=steward never falls back to a local keyfile: start the signer bridge " +
      "(@stwd/solana-signer startSignerBridge) at AGENTNET_STEWARD_SIGNER_URL, or switch " +
      "AGENTNET_SIGNER back to keyfile on purpose.",
  });
  let res;
  try {
    res = await fetchImpl(`${base}/pubkey`);
  } catch (err) {
    return refuse(err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) return refuse(`HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch {
    return refuse("the response body is not JSON");
  }
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!address) return refuse('the response carries no "address"');
  return { ok: true, address };
}
