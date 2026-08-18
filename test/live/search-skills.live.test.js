/**
 * Live-integration tests for SEARCH_AGENTNET_SKILLS: hits the real AgentNet
 * indexer (mainnet catalog, unauthenticated read). Run via `npm run
 * test:live`; may flake with public-endpoint availability.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { searchAgentnetSkills } from "../../src/actions/search-skills.js";
import { fetchCatalog } from "../../src/lib/indexer.js";

const mockRuntime = { getSetting: () => undefined }; // defaults: live indexer

test("live: indexer catalog fetch returns items with mint+name+price", async () => {
  const { total, items } = await fetchCatalog("https://nft-index.iqlabs.dev", { limit: 50 });
  assert.ok(total >= 1, `expected at least 1 catalog item, got ${total}`);
  for (const it of items) {
    assert.equal(typeof it.mint, "string");
    assert.equal(typeof it.name, "string");
    assert.ok("price" in it, "item missing price");
  }
});

test("live: action handler finds iq-onchain-db on the real market", async () => {
  const message = { content: { text: "search agentnet for an onchain db skill" } };
  const delivered = [];
  const callback = async (content) => {
    delivered.push(content);
    return [];
  };
  const result = await searchAgentnetSkills.handler(mockRuntime, message, undefined, undefined, callback);
  assert.equal(result.success, true, `handler failed: ${result.text}`);
  assert.match(result.text, /iq-onchain-db/, "expected the operator's published skill in results");
  assert.match(result.text, /free/, "iq-onchain-db is a free item");
  assert.ok(result.data.hits.some((h) => h.mint.startsWith("HmVGfSDT")), "expected mint HmVGfSDT...");
  assert.equal(delivered.length, 1, "callback should deliver once");
  assert.match(delivered[0].text, /iq-onchain-db/);
});
