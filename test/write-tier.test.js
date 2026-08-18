/**
 * Offline tests for the write tier against a recording stub client: the
 * AGENTNET_ALLOW_WRITES gate blocks everything when off (zero downstream
 * calls), AGENTNET_ALLOW_SPEND additionally gates buy/publish, buy verifies
 * on the same session before spending, argument validation fails closed
 * before any call, and recorded calls carry exactly the schema-checked args.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createWriteTierActions } from "../src/actions/write-tier.js";

const MINT = "HmVGfSDTiidWsNGEsapbACAA4EBEA5Ei91jytfzgBqz9";
const WALLET = "3BpjjjJujk6qsG6rRLdiR3Wfsgh3SdhyJ83W46VUyc3Q";

function stubClient(responses = {}) {
  const calls = [];
  return {
    calls,
    callTool: async (name, args) => {
      calls.push({ name, args });
      return responses[name]?.(args) ?? { content: [{ type: "text", text: `${name} ok` }] };
    },
  };
}

const runtimeWith = (settings = {}) => ({ getSetting: (k) => settings[k] });
const OFF = runtimeWith();
const WRITES = runtimeWith({ AGENTNET_ALLOW_WRITES: "true" });
const WRITES_AND_SPEND = runtimeWith({ AGENTNET_ALLOW_WRITES: "true", AGENTNET_ALLOW_SPEND: "1" });

function action(name, client) {
  const actions = createWriteTierActions({ getClient: async () => client });
  return actions.find((a) => a.name === name);
}

const msg = (text) => ({ content: { text } });

test("write gate OFF: handler refuses, names the setting, and calls nothing", async () => {
  const client = stubClient();
  const blog = action("POST_AGENTNET_BLOG", client);
  const result = await blog.handler(OFF, msg("post an agentnet blog: hello"), undefined, {}, undefined);
  assert.equal(result.success, false);
  assert.match(result.text, /AGENTNET_ALLOW_WRITES/);
  assert.equal(client.calls.length, 0, "gate off must reach zero tools");
  assert.equal(await blog.validate(OFF, msg("post an agentnet blog: hello")), false, "gate off leaves the action space");
});

test("write gate ON: blog posts through the stub with schema-clean args", async () => {
  const client = stubClient();
  const blog = action("POST_AGENTNET_BLOG", client);
  assert.equal(await blog.validate(WRITES, msg("post an agentnet blog: hello")), true);
  const delivered = [];
  const result = await blog.handler(WRITES, msg("ignored"), undefined, { text: "shipped the plugin" }, async (c) => {
    delivered.push(c);
    return [];
  });
  assert.equal(result.success, true, result.text);
  assert.deepEqual(client.calls, [{ name: "post_blog", args: { text: "shipped the plugin" } }]);
  assert.equal(delivered.length, 1);
});

test("blog text over the server ceiling is refused before any call", async () => {
  const client = stubClient();
  const blog = action("POST_AGENTNET_BLOG", client);
  const result = await blog.handler(WRITES, msg("x"), undefined, { text: "a".repeat(2001) }, undefined);
  assert.equal(result.success, false);
  assert.match(result.text, /2000/);
  assert.equal(client.calls.length, 0);
});

test("spend gate: buy blocked with writes on but spend off; zero calls", async () => {
  const client = stubClient();
  const buy = action("BUY_AGENTNET_SKILL", client);
  const text = `buy the agentnet skill ${MINT}`;
  assert.equal(await buy.validate(WRITES, msg(text)), false, "spend action must not validate without the spend gate");
  const result = await buy.handler(WRITES, msg(text), undefined, {}, undefined);
  assert.equal(result.success, false);
  assert.match(result.text, /AGENTNET_ALLOW_SPEND/);
  assert.equal(client.calls.length, 0);
});

test("spend gate ON: buy verifies first, then buys, on the same client session", async () => {
  const client = stubClient();
  const buy = action("BUY_AGENTNET_SKILL", client);
  const text = `buy the agentnet skill ${MINT}`;
  assert.equal(await buy.validate(WRITES_AND_SPEND, msg(text)), true);
  const result = await buy.handler(WRITES_AND_SPEND, msg(text), undefined, {}, undefined);
  assert.equal(result.success, true, result.text);
  assert.deepEqual(client.calls.map((c) => c.name), ["verify_skill", "buy_skill"], "verify must precede buy");
  assert.equal(client.calls[0].args.skillId, MINT);
  assert.deepEqual(client.calls[1].args, { skillId: MINT });
});

test("buy aborts on a verify_skill safety-scan failure: no spend call", async () => {
  const client = stubClient({
    verify_skill: () => ({ isError: true, content: [{ type: "text", text: "Rejected by safety scan: curl-pipe-sh." }] }),
  });
  const buy = action("BUY_AGENTNET_SKILL", client);
  const result = await buy.handler(WRITES_AND_SPEND, msg(`buy agentnet skill ${MINT}`), undefined, {}, undefined);
  assert.equal(result.success, false);
  assert.match(result.text, /safety scan/);
  assert.deepEqual(client.calls.map((c) => c.name), ["verify_skill"], "buy_skill must never fire after a failed verify");
});

test("publish requires explicit fields, then round-trips them verbatim", async () => {
  const client = stubClient();
  const publish = action("PUBLISH_AGENTNET_SKILL", client);
  const missing = await publish.handler(WRITES_AND_SPEND, msg("publish my skill to agentnet"), undefined, {}, undefined);
  assert.equal(missing.success, false);
  assert.match(missing.text, /name, description, text/);
  assert.equal(client.calls.length, 0);

  const options = { name: "my-skill", description: "does things", text: "# body", hashtags: ["a"], priceSol: "0" };
  const result = await publish.handler(WRITES_AND_SPEND, msg("publish my skill to agentnet"), undefined, options, undefined);
  assert.equal(result.success, true, result.text);
  assert.deepEqual(client.calls, [{ name: "publish_skill", args: options }]);
});

test("publish with a schema-hostile option fails closed before any call", async () => {
  const client = stubClient();
  const publish = action("PUBLISH_AGENTNET_SKILL", client);
  const options = { name: "n", description: "d", text: "t", hashtags: "not-an-array" };
  const result = await publish.handler(WRITES_AND_SPEND, msg("publish to agentnet"), undefined, options, undefined);
  assert.equal(result.success, false);
  assert.match(result.text, /array of strings/);
  assert.equal(client.calls.length, 0);
});

test("comment routes by explicit target: skillId vs agentWallet, neither refused", async () => {
  const client = stubClient();
  const comment = action("POST_AGENTNET_COMMENT", client);
  const onSkill = await comment.handler(WRITES, msg("agentnet comment"), undefined, { skillId: MINT, text: "great" }, undefined);
  assert.equal(onSkill.success, true, onSkill.text);
  const onAgent = await comment.handler(WRITES, msg("agentnet comment"), undefined, { agentWallet: WALLET, text: "gm" }, undefined);
  assert.equal(onAgent.success, true, onAgent.text);
  assert.deepEqual(client.calls, [
    { name: "post_skill_comment", args: { skillId: MINT, text: "great" } },
    { name: "post_agent_comment", args: { agentWallet: WALLET, text: "gm" } },
  ]);
  const neither = await comment.handler(WRITES, msg("agentnet comment"), undefined, { text: "hi" }, undefined);
  assert.equal(neither.success, false);
  assert.match(neither.text, /skillId|agentWallet/);
  assert.equal(client.calls.length, 2, "no call without an explicit target");
});

test("vault actions ride the writes gate: soul_get allowed, soul_set needs full text", async () => {
  const client = stubClient();
  const getSoul = action("GET_AGENTNET_SOUL", client);
  const offResult = await getSoul.handler(OFF, msg("show the agentnet soul"), undefined, {}, undefined);
  assert.equal(offResult.success, false, "vault needs the wallet session, so the gate applies");
  const onResult = await getSoul.handler(WRITES, msg("show the agentnet soul"), undefined, {}, undefined);
  assert.equal(onResult.success, true, onResult.text);

  const setSoul = action("SET_AGENTNET_SOUL", client);
  const noText = await setSoul.handler(WRITES, msg("update the agentnet soul"), undefined, {}, undefined);
  assert.equal(noText.success, false);
  assert.match(noText.text, /options\.text/);
  const withText = await setSoul.handler(WRITES, msg("update the agentnet soul"), undefined, { text: "# Name\nLuna" }, undefined);
  assert.equal(withText.success, true, withText.text);
  assert.deepEqual(client.calls.map((c) => c.name), ["soul_get", "soul_set"]);
});

test("memory_save defaults project to cwd and omits an unset type", async () => {
  const client = stubClient();
  const save = action("SAVE_AGENTNET_MEMORY", client);
  const options = { name: "deploy-branch", description: "deploys from main", body: "main only" };
  const result = await save.handler(WRITES, msg("save agentnet memory"), undefined, options, undefined);
  assert.equal(result.success, true, result.text);
  assert.deepEqual(client.calls, [
    { name: "memory_save", args: { project: process.cwd(), ...options } },
  ]);
  assert.ok(!("type" in client.calls[0].args), "unset type must be omitted so the server default applies");
});

test("server-reported tool errors surface as action failure", async () => {
  const client = stubClient({
    post_blog: () => ({ isError: true, content: [{ type: "text", text: "rate limited: 5 posts per 10 minutes" }] }),
  });
  const blog = action("POST_AGENTNET_BLOG", client);
  const result = await blog.handler(WRITES, msg("x"), undefined, { text: "spam" }, undefined);
  assert.equal(result.success, false);
  assert.match(result.text, /rate limited/);
});
