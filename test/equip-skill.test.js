/**
 * Offline tests for EQUIP_AGENTNET_SKILL. Deterministic, no mainnet: the
 * handler tests run against a local HTTP stub on 127.0.0.1 that serves the
 * indexer catalog, the RPC getAccountInfo route, and the gateway /data
 * route, so the free-price gate and the full equip flow are exercised
 * without any public endpoint. The live mainnet flow lives in
 * test/live/equip-skill.live.test.js.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { equipAgentnetSkill, isExplicitlyFree, resolveItem } from "../src/actions/equip-skill.js";
import { equippedSkills, renderSkillMd, writeSkillMd } from "../src/lib/skillfile.js";

const FREE_MINT = "HmVGfSDTiidWsNGEsapbACAA4EBEA5Ei91jytfzgBqz9";
const PRICED_MINT = "Es18ADJ4ZpKDojLtvNJEBGCaXpqxsmw2kG8ihS6TJC7U";

// Stub catalog: one item per price shape under test. Names are unique and
// non-overlapping so resolveItem's name route is unambiguous.
const CATALOG = [
  { mint: "MintZeroNumber11111111111111111111", name: "zero-number-skill", type: "skill", price: 0, description: "free, price is the number 0" },
  { mint: "MintZeroString11111111111111111111", name: "zero-string-skill", type: "skill", price: "0", description: "free, price is the string zero" },
  { mint: "MintNullPrice111111111111111111111", name: "null-price-skill", type: "skill", price: null, description: "price null" },
  { mint: "MintEmptyPrice11111111111111111111", name: "empty-price-skill", type: "skill", price: "", description: "price empty string" },
  { mint: "MintBlankPrice11111111111111111111", name: "blank-price-skill", type: "skill", price: " ", description: "price whitespace" },
  { mint: "MintArrayPrice11111111111111111111", name: "array-price-skill", type: "skill", price: [], description: "price empty array" },
  { mint: "MintTenthString111111111111111111", name: "tenth-string-skill", type: "skill", price: "0.1", description: "priced, string" },
  { mint: "MintTenthNumber111111111111111111", name: "tenth-number-skill", type: "skill", price: 0.1, description: "priced, number" },
];

const sigFor = (mint) => `Sig${mint}${"x".repeat(60)}`.slice(0, 88);

let server;
let baseUrl;
let rpcHits = 0;
let gatewayHits = 0;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/items") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ total: CATALOG.length, items: CATALOG }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/") {
      rpcHits += 1;
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const mint = JSON.parse(body).params[0];
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              value: {
                data: {
                  parsed: {
                    info: {
                      extensions: [
                        { extension: "tokenMetadata", state: { name: mint, uri: `${baseUrl}/skill/${mint}/${sigFor(mint)}` } },
                      ],
                    },
                  },
                },
              },
            },
          }),
        );
      });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/data/")) {
      gatewayHits += 1;
      const sig = url.pathname.slice("/data/".length);
      const item = CATALOG.find((it) => sig.includes(it.mint));
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: JSON.stringify({
            name: item?.name ?? "unknown",
            description: item?.description ?? "",
            skillText: `# ${item?.name ?? "unknown"}\n\nstub body`,
          }),
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

const dirs = [];
function stubRuntime() {
  const skillsDir = mkdtempSync(join(tmpdir(), "agentnet-equip-offline-"));
  dirs.push(skillsDir);
  const settings = {
    AGENTNET_SKILLS_DIR: skillsDir,
    AGENTNET_INDEXER_URL: baseUrl,
    AGENTNET_GATEWAY_URL: baseUrl,
    AGENTNET_RPC_URL: baseUrl,
  };
  return { skillsDir, runtime: { getSetting: (k) => settings[k] } };
}

after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

test("unit: resolveItem matches by mint, by name, and misses cleanly", () => {
  const items = [
    { mint: FREE_MINT, name: "iq-onchain-db" },
    { mint: PRICED_MINT, name: "learn-this-repo" },
  ];
  assert.equal(resolveItem(items, `equip ${FREE_MINT} please`).name, "iq-onchain-db");
  assert.equal(resolveItem(items, "equip the agentnet skill iq-onchain-db").mint, FREE_MINT);
  assert.equal(resolveItem(items, "equip something unlisted"), null);
});

test("unit: validate gates on equip wording", async () => {
  const runtime = { getSetting: () => undefined };
  const yes = { content: { text: "equip the agentnet skill iq-onchain-db" } };
  const no = { content: { text: "what skills exist" } };
  assert.equal(await equipAgentnetSkill.validate(runtime, yes), true);
  assert.equal(await equipAgentnetSkill.validate(runtime, no), false);
});

test("isExplicitlyFree: only the number 0 and the string \"0\" are free; everything else fails closed", () => {
  assert.equal(isExplicitlyFree(0), true, "number 0 is free");
  assert.equal(isExplicitlyFree("0"), true, "string \"0\" is free");
  const notFree = [null, undefined, "", " ", [], {}, NaN, "0.1", 0.1, 1, "1", " 0", "0.0", "00", true, false];
  for (const price of notFree) {
    assert.equal(isExplicitlyFree(price), false, `price ${JSON.stringify(price) ?? String(price)} must NOT count as free`);
  }
});

test("handler equips an item whose price is the number 0 (offline stub)", async () => {
  const { runtime, skillsDir } = stubRuntime();
  const result = await equipAgentnetSkill.handler(runtime, { content: { text: "equip the agentnet skill zero-number-skill" } });
  assert.equal(result.success, true, `equip failed: ${result.text}`);
  assert.equal(result.data.slug, "zero-number-skill");
  const text = readFileSync(join(skillsDir, "zero-number-skill", "SKILL.md"), "utf8");
  assert.match(text, /^---\nname: "zero-number-skill"\n/);
  assert.match(text, /\nagentnet-mint: "MintZeroNumber11111111111111111111"\n/, "mint is a JSON-quoted scalar");
  assert.match(text, /\nagentnet-sig: "Sig/, "sig is a JSON-quoted scalar");
});

test("handler equips an item whose price is the string \"0\" (offline stub)", async () => {
  const { runtime, skillsDir } = stubRuntime();
  const result = await equipAgentnetSkill.handler(runtime, { content: { text: "equip the agentnet skill zero-string-skill" } });
  assert.equal(result.success, true, `equip failed: ${result.text}`);
  assert.ok(existsSync(join(skillsDir, "zero-string-skill", "SKILL.md")));
});

test("handler refuses null/empty/whitespace/array prices as price-unknown, before any RPC or gateway call", async () => {
  for (const name of ["null-price-skill", "empty-price-skill", "blank-price-skill", "array-price-skill"]) {
    const { runtime, skillsDir } = stubRuntime();
    const rpcBefore = rpcHits;
    const gatewayBefore = gatewayHits;
    const delivered = [];
    const result = await equipAgentnetSkill.handler(
      runtime,
      { content: { text: `equip the agentnet skill ${name}` } },
      undefined,
      undefined,
      async (c) => {
        delivered.push(c);
        return [];
      },
    );
    assert.equal(result.success, false, `${name}: a price-unknown item must never equip`);
    assert.equal(result.data?.refused, "price-unknown", `${name}: refusal class`);
    assert.match(result.text, /cannot be proven free/, `${name}: clear refusal message`);
    assert.equal(rpcHits, rpcBefore, `${name}: refusal must not reach RPC`);
    assert.equal(gatewayHits, gatewayBefore, `${name}: refusal must not reach the gateway`);
    assert.ok(!existsSync(join(skillsDir, name)), `${name}: nothing may be written`);
    assert.equal(delivered.length, 1, `${name}: refusal is delivered`);
  }
});

test("handler refuses nonzero prices (string \"0.1\" and number 0.1) toward the write tier", async () => {
  for (const name of ["tenth-string-skill", "tenth-number-skill"]) {
    const { runtime, skillsDir } = stubRuntime();
    const rpcBefore = rpcHits;
    const result = await equipAgentnetSkill.handler(runtime, { content: { text: `equip the agentnet skill ${name}` } });
    assert.equal(result.success, false, `${name}: a priced item must never equip free`);
    assert.equal(result.data?.refused, "priced", `${name}: refusal class`);
    assert.match(result.text, /not a free item/, `${name}: clear refusal message`);
    assert.match(result.text, /MCP/, `${name}: refusal points at the write tier`);
    assert.equal(rpcHits, rpcBefore, `${name}: refusal must not reach RPC`);
    assert.ok(!existsSync(join(skillsDir, name)), `${name}: nothing may be written`);
  }
});

test("renderSkillMd quotes a YAML-hostile name so the loader can't be crashed by a marketplace item", () => {
  for (const slug of ["true", "123", "1e3", "null", "no", "on"]) {
    const md = renderSkillMd({ slug, description: "d", mint: "M", sig: "S", body: "b" });
    assert.match(md, new RegExp(`^---\\nname: "${slug}"\\n`), `name ${slug} must be quoted`);
  }
});

test("renderSkillMd JSON-quotes hostile mint and sig so frontmatter cannot be injected", () => {
  const hostileMint = 'M"\nname: pwned\nagentnet-mint: FakeMint';
  const hostileSig = 'S: colon "quotes"\n---\ninjected body';
  const md = renderSkillMd({ slug: "x", description: "d", mint: hostileMint, sig: hostileSig, body: "b" });
  const fmLines = md.split("\n---\n")[0].split("\n").slice(1);
  assert.equal(fmLines.length, 4, "hostile values must not add frontmatter lines");
  for (const line of fmLines) {
    assert.match(line, /^(name|description|agentnet-mint|agentnet-sig): "/, `every frontmatter value is JSON-quoted: ${line}`);
  }
  // The quoted scalars round-trip to the exact hostile input.
  assert.equal(JSON.parse(fmLines[2].slice("agentnet-mint: ".length)), hostileMint);
  assert.equal(JSON.parse(fmLines[3].slice("agentnet-sig: ".length)), hostileSig);
});

test("writeSkillMd + equippedSkills round-trip a hostile mint through the quoted marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentnet-equip-roundtrip-"));
  dirs.push(dir);
  const hostileMint = 'M"\nname: pwned';
  writeSkillMd(dir, "hostile-mint-skill", renderSkillMd({ slug: "hostile-mint-skill", description: "d", mint: hostileMint, sig: "S", body: "b" }));
  writeSkillMd(dir, "plain-skill", renderSkillMd({ slug: "plain-skill", description: "d", mint: FREE_MINT, sig: "S", body: "b" }));
  assert.deepEqual(equippedSkills(dir), [
    { slug: "hostile-mint-skill", mint: hostileMint },
    { slug: "plain-skill", mint: FREE_MINT },
  ]);
});
