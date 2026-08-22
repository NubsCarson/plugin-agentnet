/**
 * Plugin entry for plugin-agentnet: exposes the AgentNet on-chain skill
 * marketplace to Eliza agents in two tiers.
 *
 * Read tier (always on): catalog search, free skill equip, wallet profiles,
 * and an equipped-skills context provider, all against public HTTP/RPC reads.
 * No wallet, no spend.
 *
 * Write tier (default OFF): fronts the published @iqlabs-official/agentnet-mcp
 * stdio server in full mode, one wallet-armed process per runtime. Gated by
 * AGENTNET_ALLOW_WRITES, and AGENTNET_ALLOW_SPEND for buy/publish.
 *
 * Implements the Plugin contract from @elizaos/core
 * (packages/core/src/types/plugin.ts:1354); registered via the character
 * `plugins` array through loadPlugin/resolvePlugins
 * (packages/core/src/plugin.ts:224/:351).
 */
import { equipAgentnetSkill } from "./actions/equip-skill.js";
import { agentnetProfile } from "./actions/profile.js";
import { searchAgentnetSkills } from "./actions/search-skills.js";
import { writeTierActions } from "./actions/write-tier.js";
import { closeWriteSession } from "./lib/write-client.js";
import { agentnetEquipped } from "./providers/equipped.js";

const agentnetPlugin = {
  name: "agentnet",
  description:
    "AgentNet on-chain skill marketplace (Solana): search the catalog, equip free skills, read profiles. " +
    "Wallet writes (buy, publish, posts, soul, memory) run through the official agentnet-mcp server and " +
    "stay OFF until AGENTNET_ALLOW_WRITES (and AGENTNET_ALLOW_SPEND for purchases) is set.",

  init: async (_config, _runtime) => {
    // Read tier is stateless HTTP/RPC. The write tier's server process is
    // spawned lazily on the first gated action, so init stays side-effect
    // free and gate-off configurations never start a wallet session.
  },

  // dispose (plugin.ts:1422) runs on runtime teardown via
  // runPluginDispose (packages/core/src/plugin-lifecycle.ts:796): close the
  // cached write-tier server session so the wallet-armed child process never
  // outlives the runtime. No-op when the write tier never spawned.
  dispose: async (runtime) => {
    await closeWriteSession(runtime);
  },

  actions: [searchAgentnetSkills, equipAgentnetSkill, agentnetProfile, ...writeTierActions],
  providers: [agentnetEquipped],
};

export default agentnetPlugin;
export { searchAgentnetSkills, equipAgentnetSkill, agentnetProfile, agentnetEquipped, writeTierActions };
