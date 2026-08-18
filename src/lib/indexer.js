/**
 * Read-tier client for AgentNet's public catalog HTTP surface. Wraps the
 * unauthenticated indexer (nft-index.iqlabs.dev/items) and gateway
 * (gateway.iqlabs.dev: /data/<sig>, /user/<pk>/profile, /user/<pk>/posts)
 * with no wallet and no AgentNet package dependency. Endpoint shapes
 * verified against AgentNet packages/core/src/core/skillSource.ts
 * (IndexerItem) and chain.ts (gateway /data readback), and live against the
 * mainnet gateway.
 */

import { DEFAULT_RPC_URL } from "./chain.js";
import { defaultSkillsDir } from "./skillfile.js";

export const DEFAULTS = {
  indexerUrl: "https://nft-index.iqlabs.dev",
  gatewayUrl: "https://gateway.iqlabs.dev",
};

/** Resolve config through the runtime, mirroring core's getSetting-only rule
 *  (packages/core/CLAUDE.md: getSetting never reads process.env). The
 *  skillsDir default is the filesystem convention, not a setting: the
 *  user/managed skills store `<stateDir>/skills` that the skills loader scans
 *  (packages/skills/src/loader.ts:282-304). */
export function agentnetConfig(runtime) {
  const get = (k) => (runtime && runtime.getSetting ? runtime.getSetting(k) : undefined);
  return {
    indexerUrl: get("AGENTNET_INDEXER_URL") || DEFAULTS.indexerUrl,
    gatewayUrl: get("AGENTNET_GATEWAY_URL") || DEFAULTS.gatewayUrl,
    rpcUrl: get("AGENTNET_RPC_URL") || DEFAULT_RPC_URL,
    skillsDir: get("AGENTNET_SKILLS_DIR") || defaultSkillsDir(),
  };
}

/** Fetch the hydrated catalog. Returns { total, items } where each item has
 *  mint, type, name, description, creator, supply, price (lamports), stars. */
export async function fetchCatalog(indexerUrl, { limit = 50, signal } = {}) {
  const res = await fetch(`${indexerUrl}/items?limit=${limit}&sort=supply`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`agentnet indexer: HTTP ${res.status} from ${indexerUrl}/items`);
  const body = await res.json();
  const items = Array.isArray(body) ? body : (body.items ?? []);
  const total = Array.isArray(body) ? body.length : (body.total ?? items.length);
  return { total, items };
}

/** Case-insensitive token match over name/description/type. Empty query lists all. */
export function searchCatalog(items, query) {
  const tokens = (query || "")
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return items;
  return items.filter((it) => {
    const hay = `${it.name ?? ""} ${it.description ?? ""} ${it.type ?? ""}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
}

/** Read a code-in inscription body from the gateway's cached /data/<sig>
 *  route (AgentNet chain.ts readCodeIn). The gateway wraps the payload as
 *  { data: "<json string>" }; for catalog items that inner JSON carries
 *  { name, description, attributes, skillText } where skillText is the
 *  markdown body (verified live against the iq-onchain-db inscription). */
export async function fetchInscription(gatewayUrl, sig, { signal } = {}) {
  const res = await fetch(`${gatewayUrl}/data/${sig}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`agentnet gateway: HTTP ${res.status} from ${gatewayUrl}/data/${sig}`);
  const wrapper = await res.json();
  if (!wrapper.data) throw new Error(`agentnet gateway: empty body for inscription ${sig}`);
  let payload;
  try {
    payload = JSON.parse(wrapper.data);
  } catch {
    // Non-JSON inscriptions are legal on-chain; surface the raw text as the body.
    payload = { skillText: String(wrapper.data) };
  }
  return payload;
}

/** Gateway /user/<pk>/profile: at minimum { pubkey }, plus whatever profile
 *  fields the wallet has inscribed. */
export async function fetchUserProfile(gatewayUrl, wallet, { signal } = {}) {
  const res = await fetch(`${gatewayUrl}/user/${wallet}/profile`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`agentnet gateway: HTTP ${res.status} from /user/${wallet}/profile`);
  return res.json();
}

/** Gateway /user/<pk>/posts: { pubkey, signatures, count, note } where
 *  signatures are the wallet's inscription tx sigs (opportunistic index). */
export async function fetchUserPosts(gatewayUrl, wallet, { signal } = {}) {
  const res = await fetch(`${gatewayUrl}/user/${wallet}/posts`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`agentnet gateway: HTTP ${res.status} from /user/${wallet}/posts`);
  return res.json();
}

/** Render results for model context: name, type, price, mint, one-line description. */
export function formatResults(items) {
  if (items.length === 0) return "No matching AgentNet skills found.";
  return items
    .map((it) => {
      const price = Number(it.price) === 0 ? "free" : `${Number(it.price) / 1e9} SOL`;
      const desc = String(it.description ?? "").replace(/\s+/g, " ").slice(0, 160);
      return `- ${it.name} [${it.type ?? "skill"}] (${price}) mint=${it.mint}\n  ${desc}`;
    })
    .join("\n");
}
