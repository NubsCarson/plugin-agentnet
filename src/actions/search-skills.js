/**
 * SEARCH_AGENTNET_SKILLS: read-only marketplace search against the live
 * AgentNet indexer. No wallet, no RPC, no spend. Implements the Action
 * contract from @elizaos/core (packages/core/src/types/components.ts:349),
 * with Handler (:259), Validator (:274), and ActionResult (:914) shapes.
 * In a real build this file imports the types from "@elizaos/core"; the
 * scaffold is structurally compatible plain ESM so it runs standalone.
 */
import { agentnetConfig, fetchCatalog, formatResults, searchCatalog } from "../lib/indexer.js";

// Fire on any market/skill/catalog/browse intent, not just the literal word
// "agentnet". This agent is dedicated to AgentNet, so a plain "what's on the
// market?" or "any coding skills?" must reach the live catalog. Kept off
// unrelated chatter ("what is the weather") by requiring a market/skill token.
const TRIGGER_WORDS =
  /\b(agentnet|market(place)?|catalog(ue)?|skills?|workflows?|on-?chain|iq ?labs|listings?|for sale|equip|buy|purchase|available)\b/i;

// Filler stripped so only real keywords reach the matcher; a pure browse
// phrase ("what's on the market?") collapses to empty -> the whole catalog.
const FILLER =
  /\b(search|find|look ?up|show|list|browse|get|give|tell|whats?|what|is|are|there|the|a|an|me|us|any|all|everything|please|some|for|of|in|on|out|do|you|have|got|currently|right|now|see|to|about|can|could|i)\b/gi;

/** Strip trigger phrasing and filler so only content words reach the matcher. */
export function extractQuery(text) {
  return (text || "")
    .replace(new RegExp(TRIGGER_WORDS.source, "gi"), " ")
    .replace(FILLER, " ")
    .replace(/[?!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const searchAgentnetSkills = {
  name: "SEARCH_AGENTNET_SKILLS",
  description:
    "Search or browse the AgentNet on-chain skill marketplace (Solana, soulbound Token-2022 items). " +
    "USE THIS whenever the user asks what skills, workflows, or items exist, what's on the market, what's " +
    "available, what they can buy or equip, or to find something by topic. Read-only: it queries the live " +
    "public catalog indexer, costs nothing, and needs no wallet. Always report what it actually returns; " +
    "never guess or invent catalog contents.",
  similes: ["FIND_AGENTNET_SKILL", "BROWSE_SKILL_MARKET", "AGENTNET_CATALOG", "LIST_SKILLS", "WHATS_ON_THE_MARKET"],
  tags: [],

  // Validator (components.ts:274): fire only when the message names AgentNet/the market.
  validate: async (_runtime, message) => {
    const text = message?.content?.text ?? "";
    return TRIGGER_WORDS.test(text);
  },

  // Handler (components.ts:259) -> ActionResult (components.ts:914).
  handler: async (runtime, message, _state, _options, callback) => {
    const { indexerUrl } = agentnetConfig(runtime);
    const query = extractQuery(message?.content?.text ?? "");
    try {
      const { total, items } = await fetchCatalog(indexerUrl, { limit: 50 });
      const hits = searchCatalog(items, query);
      const text =
        `AgentNet catalog: ${hits.length} match(es)` +
        (query ? ` for "${query}"` : "") +
        ` (${total} items total).\n${formatResults(hits)}`;
      if (callback) await callback({ text, actions: ["SEARCH_AGENTNET_SKILLS"] }, "SEARCH_AGENTNET_SKILLS");
      return {
        success: true,
        text,
        data: { query, total, hits: hits.map((h) => ({ mint: h.mint, name: h.name, type: h.type, price: h.price })) },
      };
    } catch (err) {
      const text = `AgentNet search failed: ${err instanceof Error ? err.message : String(err)}`;
      if (callback) await callback({ text }, "SEARCH_AGENTNET_SKILLS");
      return { success: false, text };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "search agentnet for an on-chain database skill" } },
      {
        name: "agent",
        content: { text: "Found iq-onchain-db (free) on the AgentNet market.", actions: ["SEARCH_AGENTNET_SKILLS"] },
      },
    ],
    [
      { name: "user", content: { text: "what's on the market?" } },
      {
        name: "agent",
        content: { text: "Let me check the AgentNet catalog.", actions: ["SEARCH_AGENTNET_SKILLS"] },
      },
    ],
    [
      { name: "user", content: { text: "any coding skills I can grab?" } },
      {
        name: "agent",
        content: { text: "Searching the AgentNet catalog for coding skills.", actions: ["SEARCH_AGENTNET_SKILLS"] },
      },
    ],
  ],
};
