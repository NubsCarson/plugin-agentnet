/**
 * Offline test for the agentnetEquipped provider: scans a tmp skills dir
 * for our agentnet-mint frontmatter marker, skips foreign skills, and
 * composes to an empty ProviderResult when nothing is equipped. Fixtures
 * are written directly (no network) in the exact format renderSkillMd
 * produces, so this also pins the marker format the equip action writes.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { renderSkillMd } from "../src/lib/skillfile.js";
import { agentnetEquipped } from "../src/providers/equipped.js";

const FREE_MINT = "HmVGfSDTiidWsNGEsapbACAA4EBEA5Ei91jytfzgBqz9";
const skillsDir = mkdtempSync(join(tmpdir(), "agentnet-provider-"));
const emptyDir = mkdtempSync(join(tmpdir(), "agentnet-provider-empty-"));
const runtimeFor = (dir) => ({ getSetting: (k) => (k === "AGENTNET_SKILLS_DIR" ? dir : undefined) });
const message = { content: { text: "hi" } };

after(() => {
  rmSync(skillsDir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
});

test("provider lists equipped AgentNet skills and skips foreign ones", async () => {
  // Equipped fixture in the equip action's own rendering.
  mkdirSync(join(skillsDir, "iq-onchain-db"), { recursive: true });
  writeFileSync(
    join(skillsDir, "iq-onchain-db", "SKILL.md"),
    renderSkillMd({
      slug: "iq-onchain-db",
      description: "store stuff on solana permanently",
      mint: FREE_MINT,
      sig: "4i8DoN3VugCqxeTKHhrJccFvRjMfyebPtp2mwUjF4hH8XsvwZBqFY9Ba6zsXHnaCB4Db2D4JPq45uHG8MkYhVtkQ",
      body: "# IQ On-Chain DB\n\nbody",
    }),
  );
  // Foreign skill: valid SKILL.md, no agentnet-mint marker; must not appear.
  mkdirSync(join(skillsDir, "hand-written"), { recursive: true });
  writeFileSync(
    join(skillsDir, "hand-written", "SKILL.md"),
    "---\nname: hand-written\ndescription: \"not from the market\"\n---\n\nbody\n",
  );

  const result = await agentnetEquipped.get(runtimeFor(skillsDir), message, {});
  assert.equal(typeof result.text, "string");
  assert.match(result.text, /^Equipped AgentNet skills: /, "one context line");
  assert.match(result.text, /iq-onchain-db \(mint HmVGfSDT/);
  assert.ok(!result.text.includes("hand-written"), "foreign skills must be excluded");
  assert.equal(result.values.agentnetEquipped, "iq-onchain-db");
  assert.deepEqual(result.data.skills, [{ slug: "iq-onchain-db", mint: FREE_MINT }]);
});

test("provider composes to an empty ProviderResult when nothing is equipped", async () => {
  assert.deepEqual(await agentnetEquipped.get(runtimeFor(emptyDir), message, {}), {});
  // A skills dir that does not exist yet behaves the same way.
  assert.deepEqual(await agentnetEquipped.get(runtimeFor(join(emptyDir, "missing")), message, {}), {});
});
