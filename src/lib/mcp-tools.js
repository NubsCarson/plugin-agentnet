/**
 * Canonical mirror of the REAL published AgentNet MCP tool surface, verified
 * against @iqlabs-official/agentnet-mcp@0.1.0 (dist/agentnet-mcp.js:
 * SKILL_TOOLS + VAULT_TOOLS, READ_ONLY_TOOLS, BLOG_TEXT_MAX, SOUL_TEXT_MAX,
 * MEMORY_TYPES). Every tool the server registers appears here exactly once,
 * with its access class and a fail-closed argument validator, and each maps
 * to the eliza action that fronts it. The live conformance test
 * (test/live-mcp-server.test.js) checks this table against the real server's
 * tools/list so drift shows up as a test failure, not a runtime surprise.
 *
 * access classes:
 *   read        exposed even in the server's default read-only mode
 *   wallet-read needs full mode (vault reads: soul, memory); spends nothing
 *   write       mutates state (on-chain post/install/unequip or vault write);
 *               posting on-chain costs inscription fees from the wallet
 *   spend       moves real value (skill price, mint costs); subset of write
 */

export const BLOG_TEXT_MAX = 2000;
export const SOUL_TEXT_MAX = 32000;
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"];

export const MCP_TOOLS = {
  search_skills: {
    access: "read",
    elizaAction: "SEARCH_AGENTNET_SKILLS",
    fields: {
      keyword: {},
      category: {},
      type: { enum: ["skill", "workflow"] },
    },
  },
  verify_skill: {
    access: "read",
    // No standalone action: BUY_AGENTNET_SKILL always verifies first, which
    // also satisfies the server's verify-before-buy session guard.
    elizaAction: "BUY_AGENTNET_SKILL",
    fields: { skillId: { required: true } },
  },
  buy_skill: {
    access: "spend",
    elizaAction: "BUY_AGENTNET_SKILL",
    fields: { skillId: { required: true }, creatorWallet: {} },
  },
  install_skill: {
    access: "write",
    elizaAction: "SYNC_AGENTNET_SKILL",
    fields: { skillId: { required: true }, targetDir: {} },
  },
  unequip_skill: {
    access: "write",
    elizaAction: "UNEQUIP_AGENTNET_SKILL",
    fields: { skillId: { required: true } },
  },
  post_skill_comment: {
    access: "write",
    elizaAction: "POST_AGENTNET_COMMENT",
    fields: {
      skillId: { required: true },
      collectionId: {},
      text: { required: true },
      gitLink: {},
    },
  },
  post_agent_comment: {
    access: "write",
    elizaAction: "POST_AGENTNET_COMMENT",
    fields: { agentWallet: { required: true }, text: { required: true }, gitLink: {} },
  },
  post_blog: {
    access: "write",
    elizaAction: "POST_AGENTNET_BLOG",
    fields: { text: { required: true, max: BLOG_TEXT_MAX }, gitLink: {} },
  },
  publish_skill: {
    access: "spend",
    elizaAction: "PUBLISH_AGENTNET_SKILL",
    fields: {
      name: { required: true },
      description: { required: true },
      text: { required: true },
      category: {},
      hashtags: { array: true },
      priceSol: {},
      image: {},
    },
  },
  soul_get: {
    access: "wallet-read",
    elizaAction: "GET_AGENTNET_SOUL",
    fields: {},
  },
  soul_set: {
    access: "write",
    elizaAction: "SET_AGENTNET_SOUL",
    fields: { text: { required: true, max: SOUL_TEXT_MAX } },
  },
  memory_list: {
    access: "wallet-read",
    elizaAction: "LIST_AGENTNET_MEMORY",
    fields: { project: { required: true } },
  },
  memory_save: {
    access: "write",
    elizaAction: "SAVE_AGENTNET_MEMORY",
    fields: {
      project: { required: true },
      name: { required: true },
      description: { required: true },
      body: { required: true },
      type: { enum: MEMORY_TYPES },
    },
  },
};

/** The exact tool set the server exposes in default read-only mode
 *  (READ_ONLY_TOOLS in the published dist). */
export const SERVER_READ_ONLY_TOOLS = Object.keys(MCP_TOOLS).filter(
  (n) => MCP_TOOLS[n].access === "read",
);

/** Tools that move real value. Gated behind AGENTNET_ALLOW_SPEND on top of
 *  AGENTNET_ALLOW_WRITES. */
export const SPEND_TOOLS = Object.keys(MCP_TOOLS).filter(
  (n) => MCP_TOOLS[n].access === "spend",
);

/**
 * Fail-closed argument check against the mirrored schema. Unknown tools,
 * unknown keys, missing required fields, non-string values, enum misses, and
 * over-length text all refuse; nothing is silently dropped or coerced.
 * Returns { ok: true, args } with only the known, defined keys (a valid
 * input round-trips unchanged), or { ok: false, error }.
 */
export function validateArgs(toolName, args = {}) {
  const tool = MCP_TOOLS[toolName];
  if (!tool) return { ok: false, error: `unknown AgentNet MCP tool "${toolName}"` };
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: `${toolName}: arguments must be an object` };
  }
  for (const key of Object.keys(args)) {
    // Object.hasOwn, never `in`: `in` walks the prototype chain, so hostile
    // keys like __proto__, constructor, or toString would pass as "known".
    if (!Object.hasOwn(tool.fields, key)) {
      return { ok: false, error: `${toolName}: unknown argument "${key}"` };
    }
  }
  const out = {};
  for (const [key, spec] of Object.entries(tool.fields)) {
    const val = args[key];
    if (val === undefined || val === null) {
      if (spec.required) return { ok: false, error: `${toolName}: missing required argument "${key}"` };
      continue;
    }
    if (spec.array) {
      if (!Array.isArray(val) || val.some((v) => typeof v !== "string")) {
        return { ok: false, error: `${toolName}: "${key}" must be an array of strings` };
      }
    } else if (typeof val !== "string") {
      return { ok: false, error: `${toolName}: "${key}" must be a string` };
    }
    if (spec.enum && !spec.enum.includes(val)) {
      return { ok: false, error: `${toolName}: "${key}" must be one of ${spec.enum.join(", ")}` };
    }
    if (spec.max && val.length > spec.max) {
      return { ok: false, error: `${toolName}: "${key}" exceeds ${spec.max} characters (got ${val.length})` };
    }
    out[key] = val;
  }
  return { ok: true, args: out };
}
