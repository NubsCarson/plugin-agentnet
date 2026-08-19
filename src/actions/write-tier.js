/**
 * Write tier: eliza actions fronting the wallet-gated tools of the published
 * @iqlabs-official/agentnet-mcp server (spawned over stdio in full mode).
 * Every action here follows one shared flow: config gates (writes, and spend
 * for value-moving tools), explicit argument build, fail-closed schema check
 * against the mirrored tool table, then one or two tools/call requests on
 * the per-runtime server session. Actions are built from a declarative table
 * via createWriteTierActions; tests inject a recording stub through its
 * getClient parameter. Action/Handler/Validator shapes follow @elizaos/core
 * (packages/core/src/types/components.ts:349/:259/:274), same plain-ESM
 * style as the read tier.
 */
import { AGENTNET_MCP_PACKAGE } from "../lib/mcp-client.js";
import { BLOG_TEXT_MAX, validateArgs } from "../lib/mcp-tools.js";
import { getWriteClient, spendAllowed, writesAllowed } from "../lib/write-client.js";

const BASE58_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const GITHUB_URL_RE = /https:\/\/(?:www\.)?github\.com\/\S+/;

const firstMint = (text, options) =>
  options.skillId ?? String(text ?? "").match(BASE58_RE)?.[0] ?? null;

/** "post an agentnet blog: shipped today" -> "shipped today". */
const afterColon = (text) => {
  const idx = String(text ?? "").indexOf(":");
  return idx >= 0 ? String(text).slice(idx + 1).trim() : "";
};

const mcpText = (res) =>
  (res?.content ?? [])
    .map((c) => c?.text ?? "")
    .filter(Boolean)
    .join("\n") || "(no output from agentnet-mcp)";

/** Declarative specs; buildArgs(text, options) returns { args } or { error }. */
const WRITE_ACTIONS = [
  {
    name: "BUY_AGENTNET_SKILL",
    tool: "buy_skill",
    spend: true,
    description:
      "SPENDS SOL: buy a priced skill or workflow from the AgentNet marketplace with the configured wallet, " +
      "after an automatic verify_skill safety pass on the same session. Requires AGENTNET_ALLOW_WRITES and " +
      "AGENTNET_ALLOW_SPEND, and the user's explicit confirmation of the spend.",
    similes: ["PURCHASE_AGENTNET_SKILL", "BUY_SKILL_FROM_MARKET"],
    trigger: /\b(buy|purchase)\b[\s\S]*\b(agentnet|skill|workflow)\b|\bagentnet\b[\s\S]*\b(buy|purchase)\b/i,
    buildArgs: (text, options) => {
      const skillId = firstMint(text, options);
      if (!skillId) return { error: "needs the skill's base58 mint address (run SEARCH_AGENTNET_SKILLS first)." };
      return { args: { skillId, ...(options.creatorWallet ? { creatorWallet: options.creatorWallet } : {}) } };
    },
    // verify_skill first on the SAME session: the server's buy guard requires
    // it, and a safety-scan hit stops the purchase before any spend.
    run: async (client, args) => {
      const verified = await client.callTool("verify_skill", { skillId: args.skillId });
      if (verified?.isError) return verified;
      return client.callTool("buy_skill", args);
    },
    example: ["buy the agentnet skill HmVGfSDTiidWsNGEsapbACAA4EBEA5Ei91jytfzgBqz9", "Verified and bought the skill; it is installed and equipped."],
  },
  {
    name: "PUBLISH_AGENTNET_SKILL",
    tool: "publish_skill",
    spend: true,
    description:
      "SPENDS SOL: publish a new skill to the AgentNet marketplace as a soulbound Token-2022 NFT (mint plus " +
      "on-chain inscription costs). Needs explicit options: name, description, text (the SKILL.md body); " +
      "optional category, hashtags, priceSol (server default 0.1), image. Requires AGENTNET_ALLOW_WRITES and AGENTNET_ALLOW_SPEND.",
    similes: ["MINT_AGENTNET_SKILL", "LIST_SKILL_ON_MARKET"],
    trigger: /\bpublish\b[\s\S]*\b(agentnet|skill|workflow)\b|\bagentnet\b[\s\S]*\bpublish\b/i,
    buildArgs: (_text, options) => {
      const { name, description, text } = options;
      if (!name || !description || !text) {
        return { error: "needs explicit options { name, description, text } (text = the full SKILL.md body); optional { category, hashtags, priceSol, image }." };
      }
      const args = { name, description, text };
      for (const k of ["category", "hashtags", "priceSol", "image"]) {
        if (options[k] !== undefined) args[k] = options[k];
      }
      return { args };
    },
    example: ["publish my new skill to agentnet", "Published the skill to the marketplace (1 creator copy in your wallet)."],
  },
  {
    name: "POST_AGENTNET_BLOG",
    tool: "post_blog",
    description:
      "Post a blog entry on the connected wallet's OWN AgentNet profile (self-only; on-chain inscription, " +
      `costs network fees; max ${BLOG_TEXT_MAX} chars). Requires AGENTNET_ALLOW_WRITES.`,
    similes: ["AGENTNET_BLOG", "POST_TO_AGENTNET_PROFILE"],
    trigger: /\b(blog|post)\b[\s\S]*\bagentnet\b|\bagentnet\b[\s\S]*\bblog\b/i,
    buildArgs: (text, options) => {
      const body = options.text ?? afterColon(text);
      if (!body) return { error: 'needs the blog text (options.text, or after a colon: "post an agentnet blog: <text>").' };
      const gitLink = options.gitLink ?? String(text ?? "").match(GITHUB_URL_RE)?.[0];
      return { args: { text: body, ...(gitLink ? { gitLink } : {}) } };
    },
    example: ["post an agentnet blog: shipped the eliza plugin today", "Posted to your AgentNet profile."],
  },
  {
    name: "POST_AGENTNET_COMMENT",
    tool: "post_skill_comment", // routed to post_agent_comment when agentWallet is given
    description:
      "Comment on an AgentNet skill (options.skillId; needs 1+ of its token) or on an agent profile " +
      "(options.agentWallet; own wallet = self-note). On-chain inscription, costs network fees. " +
      "Requires AGENTNET_ALLOW_WRITES and explicit options { skillId | agentWallet, text }.",
    similes: ["REVIEW_AGENTNET_SKILL", "AGENTNET_NOTE"],
    trigger: /\bcomment\b[\s\S]*\bagentnet\b|\bagentnet\b[\s\S]*\b(comment|review|self-?note)\b/i,
    buildArgs: (_text, options) => {
      if (!options.text) return { error: "needs options.text (the comment body)." };
      if (options.agentWallet) {
        return {
          tool: "post_agent_comment",
          args: {
            agentWallet: options.agentWallet,
            text: options.text,
            ...(options.gitLink ? { gitLink: options.gitLink } : {}),
          },
        };
      }
      if (options.skillId) {
        return {
          args: {
            skillId: options.skillId,
            text: options.text,
            ...(options.collectionId ? { collectionId: options.collectionId } : {}),
            ...(options.gitLink ? { gitLink: options.gitLink } : {}),
          },
        };
      }
      return { error: "needs an explicit target: options.skillId (comment on a skill) or options.agentWallet (comment on a profile)." };
    },
    example: ["leave an agentnet comment on that skill", "Comment posted on the skill."],
  },
  {
    name: "SYNC_AGENTNET_SKILL",
    tool: "install_skill",
    description:
      "Install a skill the wallet already OWNS into the local skills directory (owned-sync for skills bought " +
      "earlier or on another machine). Spends nothing, touches nothing on-chain. Requires AGENTNET_ALLOW_WRITES.",
    similes: ["INSTALL_OWNED_AGENTNET_SKILL", "RESYNC_AGENTNET_SKILL"],
    trigger: /\b(sync|re-?install)\b[\s\S]*\bagentnet\b|\bagentnet\b[\s\S]*\b(sync|owned)\b/i,
    buildArgs: (text, options) => {
      const skillId = firstMint(text, options);
      if (!skillId) return { error: "needs the owned skill's base58 mint address." };
      return { args: { skillId, ...(options.targetDir ? { targetDir: options.targetDir } : {}) } };
    },
    example: ["sync my owned agentnet skill HmVGfSDTiidWsNGEsapbACAA4EBEA5Ei91jytfzgBqz9", "Installed the owned skill locally."],
  },
  {
    name: "UNEQUIP_AGENTNET_SKILL",
    tool: "unequip_skill",
    description:
      "Un-equip an AgentNet skill locally: removes its SKILL.md and remembers the choice. Local only; the " +
      "soulbound NFT stays in the wallet and published skills stay listed. Requires AGENTNET_ALLOW_WRITES.",
    similes: ["REMOVE_AGENTNET_SKILL", "DISABLE_AGENTNET_SKILL"],
    trigger: /\b(unequip|uninstall|remove)\b[\s\S]*\b(agentnet|skill)\b/i,
    buildArgs: (text, options) => {
      const skillId = firstMint(text, options);
      if (!skillId) return { error: "needs the skill's base58 mint address." };
      return { args: { skillId } };
    },
    example: ["unequip the skill HmVGfSDTiidWsNGEsapbACAA4EBEA5Ei91jytfzgBqz9", "Un-equipped locally; the NFT stays in your wallet."],
  },
  {
    name: "GET_AGENTNET_SOUL",
    tool: "soul_get",
    description:
      "Read the wallet's soul document (the cross-runtime persona SOUL.md) from the AgentNet vault. " +
      "Spends nothing, but needs the wallet session, so AGENTNET_ALLOW_WRITES is required.",
    similes: ["READ_AGENTNET_SOUL", "AGENTNET_PERSONA"],
    trigger: /\b(agentnet|wallet)\b[\s\S]*\bsoul\b|\bsoul\b[\s\S]*\b(agentnet|wallet)\b/i,
    buildArgs: () => ({ args: {} }),
    example: ["show the agentnet soul for this wallet", "Here is the wallet's soul document."],
  },
  {
    name: "SET_AGENTNET_SOUL",
    tool: "soul_set",
    description:
      "Replace the wallet's soul document (whole-document overwrite of the cross-runtime persona). " +
      "Call GET_AGENTNET_SOUL first and change only what the user asked. Requires AGENTNET_ALLOW_WRITES " +
      "and explicit options.text (the full SOUL.md markdown).",
    similes: ["WRITE_AGENTNET_SOUL", "UPDATE_AGENTNET_PERSONA"],
    trigger: /\b(set|update|write|edit)\b[\s\S]*\b(agentnet|wallet)\b[\s\S]*\bsoul\b|\bsoul\b[\s\S]*\bagentnet\b/i,
    buildArgs: (_text, options) => {
      if (!options.text) return { error: "needs options.text with the FULL SOUL.md markdown (whole-document overwrite; read it first with GET_AGENTNET_SOUL)." };
      return { args: { text: options.text } };
    },
    example: ["update the agentnet soul with the new style section", "Soul updated for every runtime on this wallet."],
  },
  {
    name: "LIST_AGENTNET_MEMORY",
    tool: "memory_list",
    description:
      "Read the wallet's durable AgentNet memory records for a project (facts saved by any runtime on any " +
      "machine). Spends nothing, but needs the wallet session, so AGENTNET_ALLOW_WRITES is required.",
    similes: ["READ_AGENTNET_MEMORY", "AGENTNET_MEMORIES"],
    trigger: /\bagentnet\b[\s\S]*\bmemor(y|ies)\b|\bmemor(y|ies)\b[\s\S]*\bagentnet\b/i,
    buildArgs: (_text, options) => ({ args: { project: options.project ?? process.cwd() } }),
    example: ["list the agentnet memory for this project", "3 memory records for this project."],
  },
  {
    name: "SAVE_AGENTNET_MEMORY",
    tool: "memory_save",
    description:
      "Save ONE durable memory record for a project to the wallet's AgentNet vault so it reaches every " +
      "machine and runtime (same name updates the record). Requires AGENTNET_ALLOW_WRITES and options " +
      "{ name, description, body }; optional { project (default cwd), type: user|feedback|project|reference }.",
    similes: ["REMEMBER_TO_AGENTNET", "AGENTNET_MEMORY_SAVE"],
    trigger: /\b(save|remember)\b[\s\S]*\bagentnet\b|\bagentnet\b[\s\S]*\b(save|remember)\b[\s\S]*\bmemor/i,
    buildArgs: (_text, options) => {
      const { name, description, body } = options;
      if (!name || !description || !body) {
        return { error: "needs options { name (kebab-case slug), description (one line), body (markdown) }; optional { project, type }." };
      }
      return {
        args: {
          project: options.project ?? process.cwd(),
          name,
          description,
          body,
          ...(options.type ? { type: options.type } : {}),
        },
      };
    },
    example: ["save to agentnet memory that this repo deploys from main", "Saved memory record for this project."],
  },
];

function makeWriteAction(def, getClient) {
  return {
    name: def.name,
    description: def.description,
    similes: def.similes,
    tags: [],

    // Gate first so disabled writes never enter the action space; then the
    // wording trigger.
    validate: async (runtime, message) => {
      if (!writesAllowed(runtime)) return false;
      if (def.spend && !spendAllowed(runtime)) return false;
      return def.trigger.test(message?.content?.text ?? "");
    },

    // Handlers re-check the gates (they can be invoked directly) and refuse
    // with the exact setting to flip, calling nothing downstream.
    handler: async (runtime, message, _state, options, callback) => {
      const deliver = async (text) => {
        if (callback) await callback({ text, actions: [def.name] }, def.name);
      };
      const fail = async (text) => {
        await deliver(text);
        return { success: false, text };
      };
      if (!writesAllowed(runtime)) {
        return fail(
          `${def.name} is disabled: the AgentNet write tier is off. Set AGENTNET_ALLOW_WRITES=true to let this agent ` +
            `run a wallet-armed ${AGENTNET_MCP_PACKAGE} session. It stays off by default so the agent cannot write or spend by accident.`,
        );
      }
      if (def.spend && !spendAllowed(runtime)) {
        return fail(
          `${def.name} SPENDS SOL from the AgentNet wallet and is disabled. Set AGENTNET_ALLOW_SPEND=true ` +
            `(on top of AGENTNET_ALLOW_WRITES) to allow value-moving tools. Nothing was called.`,
        );
      }
      const built = def.buildArgs(message?.content?.text ?? "", options ?? {});
      if (built.error) return fail(`${def.name}: ${built.error}`);
      const tool = built.tool ?? def.tool;
      const checked = validateArgs(tool, built.args);
      if (!checked.ok) return fail(`${def.name}: ${checked.error}`);
      try {
        const client = await getClient(runtime);
        const res = def.run ? await def.run(client, checked.args) : await client.callTool(tool, checked.args);
        const text = mcpText(res);
        if (res?.isError) return fail(`${def.name} failed: ${text}`);
        await deliver(text);
        return { success: true, text, data: { tool, args: checked.args } };
      } catch (err) {
        return fail(`${def.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    examples: [
      [
        { name: "user", content: { text: def.example[0] } },
        { name: "agent", content: { text: def.example[1], actions: [def.name] } },
      ],
    ],
  };
}

/** Build the write-tier action set. Tests inject getClient to run against a
 *  recording stub instead of a spawned server. */
export function createWriteTierActions({ getClient = (runtime) => getWriteClient(runtime) } = {}) {
  return WRITE_ACTIONS.map((def) => makeWriteAction(def, getClient));
}

export const writeTierActions = createWriteTierActions();
