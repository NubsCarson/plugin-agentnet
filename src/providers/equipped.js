/**
 * agentnetEquipped provider: one context line listing the AgentNet skills
 * currently equipped on disk, so the model knows what it already has before
 * reaching for the market. Purely local (scans each skills subdirectory's
 * SKILL.md for our agentnet-mint frontmatter marker); nothing equipped is an
 * empty ProviderResult so it costs zero prompt space. Implements the
 * Provider contract from @elizaos/core (packages/core/src/types/
 * components.ts:733) with get (:857) returning ProviderResult (:702).
 */
import { agentnetConfig } from "../lib/indexer.js";
import { equippedSkills } from "../lib/skillfile.js";

export const agentnetEquipped = {
  name: "AGENTNET_EQUIPPED",
  description: "Lists AgentNet marketplace skills currently equipped as local SKILL.md files.",
  dynamic: true,

  // get (components.ts:857): read-only local scan, no side effects.
  get: async (runtime, _message, _state) => {
    const { skillsDir } = agentnetConfig(runtime);
    const skills = equippedSkills(skillsDir);
    if (skills.length === 0) return {};
    const line = `Equipped AgentNet skills: ${skills.map((s) => `${s.slug} (mint ${s.mint})`).join(", ")}.`;
    return {
      text: line,
      values: { agentnetEquipped: skills.map((s) => s.slug).join(", ") },
      data: { skills },
    };
  },
};
