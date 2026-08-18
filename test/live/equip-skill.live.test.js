/**
 * Live-integration test for EQUIP_AGENTNET_SKILL: equips the real free
 * skill iq-onchain-db (mint HmVGfSDTiidWsNGEsapbACAA4EBEA5Ei91jytfzgBqz9,
 * owner-created) end to end against mainnet READ endpoints only: indexer
 * catalog, public RPC getAccountInfo, gateway /data/<sig>. Writes land in
 * a per-run tmp dir. No transactions, no wallet. Run via `npm run
 * test:live`; public RPC may flake.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { equipAgentnetSkill } from "../../src/actions/equip-skill.js";

const FREE_MINT = "HmVGfSDTiidWsNGEsapbACAA4EBEA5Ei91jytfzgBqz9";
const skillsDir = mkdtempSync(join(tmpdir(), "agentnet-equip-live-"));
// Core's getSetting deliberately never reads process.env; hosts fold dotenv
// into the runtime settings map. This mock does the host's folding so
// AGENTNET_RPC_URL=... on the test command line reaches the action (the
// default api.mainnet-beta.solana.com pool has tarpitting members).
const mockRuntime = {
  getSetting: (k) => (k === "AGENTNET_SKILLS_DIR" ? skillsDir : process.env[k]),
};

after(() => rmSync(skillsDir, { recursive: true, force: true }));

test("live: equips iq-onchain-db into SKILL.md with our frontmatter", async () => {
  const message = { content: { text: "equip the agentnet skill iq-onchain-db" } };
  const delivered = [];
  const callback = async (content) => {
    delivered.push(content);
    return [];
  };
  const result = await equipAgentnetSkill.handler(mockRuntime, message, undefined, undefined, callback);
  assert.equal(result.success, true, `equip failed: ${result.text}`);
  assert.equal(result.data.mint, FREE_MINT);
  assert.equal(result.data.slug, "iq-onchain-db");
  assert.equal(result.data.already, false);

  const file = join(skillsDir, "iq-onchain-db", "SKILL.md");
  assert.ok(existsSync(file), "SKILL.md not written");
  const text = readFileSync(file, "utf8");
  // @elizaos/skills loader contract: frontmatter name equals the parent dir.
  assert.match(text, /^---\nname: "iq-onchain-db"\n/, "frontmatter name is a quoted YAML scalar (a numeric/reserved slug must not crash the loader)");
  assert.match(text, /\ndescription: "store stuff on solana/, "description from the inscription");
  assert.match(text, new RegExp(`\nagentnet-mint: "${FREE_MINT}"\n`), "provenance marker (JSON-quoted scalar)");
  assert.match(text, /\nagentnet-sig: "/, "inscription signature (JSON-quoted scalar)");
  assert.match(text, /\n---\n\n# IQ On-Chain DB/, "markdown body follows the frontmatter");
  assert.equal(delivered.length, 1);
});

test("live: re-equip is idempotent", async () => {
  const message = { content: { text: `equip agentnet skill ${FREE_MINT}` } };
  const result = await equipAgentnetSkill.handler(mockRuntime, message, undefined, undefined, undefined);
  assert.equal(result.success, true, `re-equip failed: ${result.text}`);
  assert.equal(result.data.already, true, "second equip should detect identical content");
  assert.match(result.text, /already equipped/);
});

test("live: priced item is refused toward the MCP write tier", async () => {
  const message = { content: { text: "equip the agentnet skill learn-this-repo" } };
  const result = await equipAgentnetSkill.handler(mockRuntime, message, undefined, undefined, undefined);
  assert.equal(result.success, false, "priced equip must not succeed");
  assert.equal(result.data?.refused, "priced");
  assert.match(result.text, /MCP/, "refusal should point at the MCP write tier");
  assert.ok(!existsSync(join(skillsDir, "learn-this-repo")), "no file may be written for a priced item");
});
