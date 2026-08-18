/**
 * EQUIP_AGENTNET_SKILL: install a FREE AgentNet catalog item as a local
 * SKILL.md so the skills loader (and USE_SKILL) can pick it up. Read tier
 * only: resolves the item via the public indexer, resolves the inscription
 * signature from the mint's Token-2022 metadata uri over public mainnet RPC
 * (getAccountInfo, read-only), fetches the body from the gateway's
 * /data/<sig> cache, and writes <skillsDir>/<slug>/SKILL.md in the
 * @elizaos/skills format. Priced items are refused and pointed at the
 * AgentNet MCP write tier, which owns wallets and spend. Implements the
 * Action contract from @elizaos/core (packages/core/src/types/
 * components.ts:349) with Handler (:259), Validator (:274), and
 * ActionResult (:914) shapes, same plain-ESM style as search-skills.
 */
import { fetchMintMetadata } from "../lib/chain.js";
import { agentnetConfig, fetchCatalog, fetchInscription } from "../lib/indexer.js";
import { renderSkillMd, slugify, writeSkillMd } from "../lib/skillfile.js";

const TRIGGER = /\b(equip|install|add)\b[\s\S]*\b(agentnet|skill|workflow)\b|\bagentnet\b[\s\S]*\b(equip|install)\b/i;
const BASE58_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

/** Resolve a catalog item from free text: exact mint token first, then any
 *  catalog name that appears verbatim in the text (longest name wins so
 *  "iq-onchain-db-pro" is not shadowed by "iq-onchain-db"). */
export function resolveItem(items, text) {
  const t = String(text ?? "");
  const mints = t.match(BASE58_RE) ?? [];
  for (const mint of mints) {
    const hit = items.find((it) => it.mint === mint);
    if (hit) return hit;
  }
  const lower = t.toLowerCase();
  const byName = items
    .filter((it) => it.name && lower.includes(String(it.name).toLowerCase()))
    .sort((a, b) => String(b.name).length - String(a.name).length);
  return byName[0] ?? null;
}

/** Fail-CLOSED free check: only a price that is explicitly the number 0 or
 *  the string "0" proves an item free. Everything else (null, undefined,
 *  empty or whitespace strings, arrays, objects, NaN, any nonzero value)
 *  is NOT proven free and must refuse. Never coerce with Number(): it turns
 *  null/""/" "/[] into 0 and would equip a priced-unknown item for free. */
export function isExplicitlyFree(price) {
  return price === 0 || price === "0";
}

export const equipAgentnetSkill = {
  name: "EQUIP_AGENTNET_SKILL",
  description:
    "Equip a FREE skill or workflow from the AgentNet on-chain marketplace: fetch its inscribed body " +
    "(mint metadata via mainnet RPC, content via the gateway) and install it as a local SKILL.md. " +
    "Read-only on chain; priced items require the AgentNet MCP write tier.",
  similes: ["INSTALL_AGENTNET_SKILL", "ADD_AGENTNET_SKILL", "EQUIP_SKILL_FROM_MARKET"],
  tags: [],

  // Validator (components.ts:274): an equip verb near AgentNet/skill wording.
  validate: async (_runtime, message) => {
    const text = message?.content?.text ?? "";
    return TRIGGER.test(text);
  },

  // Handler (components.ts:259) -> ActionResult (components.ts:914).
  handler: async (runtime, message, _state, _options, callback) => {
    const { indexerUrl, gatewayUrl, rpcUrl, skillsDir } = agentnetConfig(runtime);
    const deliver = async (text) => {
      if (callback) await callback({ text }, "EQUIP_AGENTNET_SKILL");
    };
    try {
      const { items } = await fetchCatalog(indexerUrl, { limit: 100 });
      const item = resolveItem(items, message?.content?.text ?? "");
      if (!item) {
        const text =
          "Could not resolve that AgentNet item. Name it exactly (try SEARCH_AGENTNET_SKILLS first) or give its mint address.";
        await deliver(text);
        return { success: false, text };
      }
      if (!isExplicitlyFree(item.price)) {
        const priced = Number(item.price) > 0;
        const text = priced
          ? `"${item.name}" is not a free item (${Number(item.price) / 1e9} SOL). Equipping here is the free read tier; ` +
            "buying runs through the AgentNet MCP server's write tier, which holds the wallet and handles payment. " +
            "Connect the AgentNet MCP server and use its buy tool instead."
          : `"${item.name}" cannot be proven free (price ${JSON.stringify(item.price) ?? String(item.price)}); ` +
            "refusing to equip it on the read tier. Only an explicit price of 0 equips for free.";
        await deliver(text);
        return {
          success: false,
          text,
          data: { mint: item.mint, name: item.name, price: item.price, refused: priced ? "priced" : "price-unknown" },
        };
      }

      const meta = await fetchMintMetadata(rpcUrl, item.mint);
      const payload = await fetchInscription(gatewayUrl, meta.sig);
      const body = payload.skillText || payload.workflowText;
      if (!body) throw new Error(`inscription ${meta.sig} has no skillText body`);

      const slug = slugify(payload.name || item.name);
      const rendered = renderSkillMd({
        slug,
        description: payload.description || item.description,
        mint: item.mint,
        sig: meta.sig,
        body,
      });
      const { file, already } = writeSkillMd(skillsDir, slug, rendered);
      const text = already
        ? `"${slug}" is already equipped and up to date at ${file}.`
        : `Equipped AgentNet ${item.type ?? "skill"} "${slug}" to ${file} (mint ${item.mint}, inscription ${meta.sig}).`;
      await deliver(text);
      return { success: true, text, data: { mint: item.mint, slug, file, sig: meta.sig, already } };
    } catch (err) {
      const text = `AgentNet equip failed: ${err instanceof Error ? err.message : String(err)}`;
      await deliver(text);
      return { success: false, text };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "equip the agentnet skill iq-onchain-db" } },
      {
        name: "agent",
        content: { text: "Equipped iq-onchain-db from the AgentNet market.", actions: ["EQUIP_AGENTNET_SKILL"] },
      },
    ],
  ],
};
