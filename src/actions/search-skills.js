/**
 * SEARCH_AGENTNET_SKILLS: read-only marketplace search against the live
 * AgentNet indexer. No wallet, no RPC, no spend. Implements the Action
 * contract from @elizaos/core (packages/core/src/types/components.ts:349),
 * with Handler (:259), Validator (:274), and ActionResult (:914) shapes.
 * In a real build this file imports the types from "@elizaos/core"; the
 * scaffold is structurally compatible plain ESM so it runs standalone.
 */
import { agentnetConfig, fetchCatalog, formatResults, searchCatalog } from "../lib/indexer.js";

const TRIGGER_WORDS = /\b(agentnet|skill market|marketplace|on-?chain skill|iq ?labs)\b/i;

/** Strip trigger phrasing so only content words reach the matcher. */
export function extractQuery(text) {
  return (text || "")
    .replace(TRIGGER_WORDS, " ")
    .replace(/\b(search|find|look ?up|show|list|for|the|a|an|me|any|please|skills?|workflows?|on|in)\b/gi, " ")
    .trim();
}

export const searchAgentnetSkills = {
  name: "SEARCH_AGENTNET_SKILLS",
  description:
    "Search the AgentNet on-chain skill marketplace (Solana, soulbound Token-2022 items) by keyword. " +
    "Read-only: queries the public catalog indexer; costs nothing and needs no wallet.",
  similes: ["FIND_AGENTNET_SKILL", "BROWSE_SKILL_MARKET", "AGENTNET_CATALOG"],
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
      if (callback) await callback({ text }, "SEARCH_AGENTNET_SKILLS");
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
  ],
};
