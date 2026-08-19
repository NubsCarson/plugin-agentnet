/**
 * AGENTNET_PROFILE: compact read-only profile of a wallet on AgentNet.
 * Combines the gateway's /user/<pk>/profile and /user/<pk>/posts with the
 * indexer catalog filtered to items the wallet created. Standing follows
 * the documented fame metric (AgentNet reputation.ts: "Famous agent = sum
 * of supply across the skills that agent created"), derived live from the
 * indexer's hydrated supply. Implements the Action contract from
 * @elizaos/core (packages/core/src/types/components.ts:349) with Handler
 * (:259), Validator (:274), and ActionResult (:914) shapes.
 */
import { agentnetConfig, fetchCatalog, fetchUserPosts, fetchUserProfile } from "../lib/indexer.js";

const TRIGGER = /\bagentnet\b[\s\S]*\b(profile|reputation|standing|creator)\b|\b(profile|reputation)\b[\s\S]*\bagentnet\b/i;
const BASE58_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

export function extractWallet(text) {
  const m = String(text ?? "").match(BASE58_RE);
  return m ? m[0] : null;
}

/** Render the compact text profile from the three read surfaces. */
export function formatProfile(wallet, profile, posts, created) {
  const lines = [`AgentNet profile for ${wallet}`];
  const extra = Object.entries(profile ?? {})
    .filter(([k, v]) => k !== "pubkey" && typeof v === "string" && v)
    .map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, " ").slice(0, 120)}`);
  if (extra.length > 0) lines.push(...extra);
  const postCount = posts && typeof posts.count === "number" ? posts.count : 0;
  lines.push(`Posts: ${postCount} inscription(s) indexed by the gateway.`);
  if (created.length === 0) {
    lines.push("Created items: none in the catalog.");
  } else {
    const totalSupply = created.reduce((acc, it) => acc + Number(it.supply ?? 0), 0);
    lines.push(`Created items: ${created.length} (total supply ${totalSupply}, the fame metric).`);
    for (const it of created) {
      const price = Number(it.price) === 0 ? "free" : `${Number(it.price) / 1e9} SOL`;
      lines.push(`- ${it.name} [${it.type ?? "skill"}] (${price}) supply=${it.supply} stars=${it.stars ?? 0} mint=${it.mint}`);
    }
  }
  return lines.join("\n");
}

export const agentnetProfile = {
  name: "AGENTNET_PROFILE",
  description:
    "Look up a wallet's AgentNet profile: gateway profile fields, inscription post count, and the catalog " +
    "items it created with supply (the fame metric). Read-only, needs only a wallet address.",
  similes: ["AGENTNET_REPUTATION", "AGENTNET_CREATOR_PROFILE", "WHO_IS_AGENTNET_WALLET"],
  tags: [],

  // Validator (components.ts:274): profile wording near AgentNet plus a wallet.
  validate: async (_runtime, message) => {
    const text = message?.content?.text ?? "";
    return TRIGGER.test(text) && extractWallet(text) !== null;
  },

  // Handler (components.ts:259) -> ActionResult (components.ts:914).
  handler: async (runtime, message, _state, _options, callback) => {
    const { indexerUrl, gatewayUrl } = agentnetConfig(runtime);
    const deliver = async (text) => {
      if (callback) await callback({ text, actions: ["AGENTNET_PROFILE"] }, "AGENTNET_PROFILE");
    };
    const wallet = extractWallet(message?.content?.text ?? "");
    if (!wallet) {
      const text = "AGENTNET_PROFILE needs a wallet address (base58 public key) in the message.";
      await deliver(text);
      return { success: false, text };
    }
    try {
      // Profile and posts are best-effort (older gateways may lack the routes);
      // the catalog read is the load-bearing surface, so it still throws.
      const [profile, posts, catalog] = await Promise.all([
        fetchUserProfile(gatewayUrl, wallet).catch(() => null),
        fetchUserPosts(gatewayUrl, wallet).catch(() => null),
        fetchCatalog(indexerUrl, { limit: 100 }),
      ]);
      const created = catalog.items.filter((it) => it.creator === wallet);
      const text = formatProfile(wallet, profile, posts, created);
      await deliver(text);
      return {
        success: true,
        text,
        data: {
          wallet,
          posts: posts?.count ?? 0,
          created: created.map((it) => ({ mint: it.mint, name: it.name, type: it.type, supply: it.supply, price: it.price })),
        },
      };
    } catch (err) {
      const text = `AgentNet profile lookup failed: ${err instanceof Error ? err.message : String(err)}`;
      await deliver(text);
      return { success: false, text };
    }
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "show the agentnet profile for 3BpjjjJujk6qsG6rRLdiR3Wfsgh3SdhyJ83W46VUyc3Q" },
      },
      {
        name: "agent",
        content: { text: "That wallet created 2 items with total supply 3 on AgentNet.", actions: ["AGENTNET_PROFILE"] },
      },
    ],
  ],
};
