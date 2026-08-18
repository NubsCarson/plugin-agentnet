/**
 * Offline tests for the mirrored MCP tool table: the tool set matches the
 * published @iqlabs-official/agentnet-mcp@0.1.0 surface exactly, every tool
 * maps to a registered eliza action, and the fail-closed validator
 * round-trips valid inputs and refuses everything else.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import agentnetPlugin from "../src/index.js";
import {
  BLOG_TEXT_MAX,
  MCP_TOOLS,
  SERVER_READ_ONLY_TOOLS,
  SPEND_TOOLS,
  validateArgs,
} from "../src/lib/mcp-tools.js";

// Ground truth read from the published dist (SKILL_TOOLS + VAULT_TOOLS).
const PUBLISHED_TOOLS = [
  "search_skills",
  "verify_skill",
  "buy_skill",
  "install_skill",
  "unequip_skill",
  "post_skill_comment",
  "post_agent_comment",
  "post_blog",
  "publish_skill",
  "soul_get",
  "soul_set",
  "memory_list",
  "memory_save",
];

const MINT = "HmVGfSDTiidWsNGEsapbACAA4EBEA5Ei91jytfzgBqz9";
const WALLET = "3BpjjjJujk6qsG6rRLdiR3Wfsgh3SdhyJ83W46VUyc3Q";

// One fully-specified valid input per tool; must round-trip unchanged.
const VALID = {
  search_skills: { keyword: "db", category: "ai", type: "skill" },
  verify_skill: { skillId: MINT },
  buy_skill: { skillId: MINT, creatorWallet: WALLET },
  install_skill: { skillId: MINT, targetDir: "/tmp/skills" },
  unequip_skill: { skillId: MINT },
  post_skill_comment: { skillId: MINT, collectionId: WALLET, text: "solid skill", gitLink: "https://github.com/a/b" },
  post_agent_comment: { agentWallet: WALLET, text: "gm", gitLink: "https://github.com/a/b" },
  post_blog: { text: "shipped the eliza plugin", gitLink: "https://github.com/a/b" },
  publish_skill: {
    name: "clean-code-refactor",
    description: "refactoring rubric",
    text: "# Skill body",
    category: "clean-code",
    hashtags: ["refactoring", "testing"],
    priceSol: "0",
    image: "https://example.com/x.png",
  },
  soul_get: {},
  soul_set: { text: "# Name\nLuna" },
  memory_list: { project: "/tmp/proj" },
  memory_save: { project: "/tmp/proj", name: "deploy-branch", description: "deploys from main", body: "main only", type: "project" },
};

test("mirror covers the published tool set exactly", () => {
  assert.deepEqual(Object.keys(MCP_TOOLS).sort(), [...PUBLISHED_TOOLS].sort());
});

test("access classes match the server: read-only subset and spend tools", () => {
  // READ_ONLY_TOOLS in the published dist.
  assert.deepEqual(SERVER_READ_ONLY_TOOLS.sort(), ["search_skills", "verify_skill"]);
  // The two value-moving tools.
  assert.deepEqual(SPEND_TOOLS.sort(), ["buy_skill", "publish_skill"]);
});

test("every published tool maps to a registered plugin action", () => {
  const registered = new Set(agentnetPlugin.actions.map((a) => a.name));
  for (const [tool, spec] of Object.entries(MCP_TOOLS)) {
    assert.ok(spec.elizaAction, `${tool} has no eliza action mapping`);
    assert.ok(registered.has(spec.elizaAction), `${tool} maps to unregistered action ${spec.elizaAction}`);
  }
});

test("validateArgs round-trips a fully-specified valid input for every tool", () => {
  for (const tool of PUBLISHED_TOOLS) {
    const res = validateArgs(tool, VALID[tool]);
    assert.equal(res.ok, true, `${tool}: ${res.error}`);
    assert.deepEqual(res.args, VALID[tool], `${tool} args must round-trip unchanged`);
  }
});

test("validateArgs refuses missing required fields for every tool that has them", () => {
  for (const [tool, spec] of Object.entries(MCP_TOOLS)) {
    for (const [field, fs] of Object.entries(spec.fields)) {
      if (!fs.required) continue;
      const args = { ...VALID[tool] };
      delete args[field];
      const res = validateArgs(tool, args);
      assert.equal(res.ok, false, `${tool} must refuse missing ${field}`);
      assert.match(res.error, new RegExp(field));
    }
  }
});

test("validateArgs fails closed on unknown tools, unknown keys, and bad types", () => {
  assert.equal(validateArgs("register_work", {}).ok, false, "tool the server never published");
  assert.equal(validateArgs("post_blog", { text: "x", evil: "y" }).ok, false, "unknown key");
  assert.equal(validateArgs("post_blog", { text: 42 }).ok, false, "non-string value");
  assert.equal(validateArgs("publish_skill", { ...VALID.publish_skill, hashtags: "not-an-array" }).ok, false);
  assert.equal(validateArgs("publish_skill", { ...VALID.publish_skill, hashtags: [1] }).ok, false);
  assert.equal(validateArgs("search_skills", { type: "bundle" }).ok, false, "enum miss");
  assert.equal(validateArgs("memory_save", { ...VALID.memory_save, type: "secret" }).ok, false, "enum miss");
});

test("validateArgs refuses prototype-chain keys as unknown (Object.hasOwn semantics, not `in`)", () => {
  // Object literals treat a literal __proto__ key as a prototype set, so
  // build that fixture via JSON.parse, which creates a real own key.
  const protoArgs = JSON.parse('{"text":"x","__proto__":"y"}');
  assert.ok(Object.keys(protoArgs).includes("__proto__"), "fixture must carry __proto__ as an own key");
  const hostiles = [
    protoArgs,
    { text: "x", constructor: "y" },
    { text: "x", toString: "y" },
    { text: "x", hasOwnProperty: "y" },
    { text: "x", valueOf: "y" },
  ];
  for (const args of hostiles) {
    const res = validateArgs("post_blog", args);
    assert.equal(res.ok, false, `hostile key set [${Object.keys(args).join(", ")}] must refuse`);
    assert.match(res.error, /unknown argument/, "hostile keys are unknown, not silently dropped");
  }
});

test("validateArgs enforces the server's text ceilings (blog 2000, soul 32000)", () => {
  assert.equal(validateArgs("post_blog", { text: "a".repeat(BLOG_TEXT_MAX) }).ok, true);
  const over = validateArgs("post_blog", { text: "a".repeat(BLOG_TEXT_MAX + 1) });
  assert.equal(over.ok, false);
  assert.match(over.error, /2000/);
  assert.equal(validateArgs("soul_set", { text: "a".repeat(32001) }).ok, false);
});

test("optional fields may be omitted", () => {
  assert.equal(validateArgs("search_skills", {}).ok, true);
  assert.equal(validateArgs("buy_skill", { skillId: MINT }).ok, true);
  assert.equal(validateArgs("publish_skill", { name: "n", description: "d", text: "t" }).ok, true);
  assert.equal(validateArgs("memory_save", { project: "/p", name: "n", description: "d", body: "b" }).ok, true);
});
