/**
 * Offline tests for SEARCH_AGENTNET_SKILLS: the catalog matcher and the
 * action's validate gate, no network. The mainnet indexer integration lives
 * in test/live/search-skills.live.test.js.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { searchAgentnetSkills } from "../src/actions/search-skills.js";
import { searchCatalog } from "../src/lib/indexer.js";

const mockRuntime = { getSetting: () => undefined };

test("unit: searchCatalog token match and empty-query passthrough", () => {
  const items = [
    { name: "iq-onchain-db", description: "save data onchain", type: "skill" },
    { name: "no-swap-manifesto", description: "code style pledge", type: "skill" },
  ];
  assert.equal(searchCatalog(items, "onchain db").length, 1);
  assert.equal(searchCatalog(items, "").length, 2);
  assert.equal(searchCatalog(items, "zzzz-nothing").length, 0);
});

test("unit: action validate gates on trigger words", async () => {
  const yes = { content: { text: "search agentnet for an onchain db skill" } };
  const no = { content: { text: "what is the weather" } };
  assert.equal(await searchAgentnetSkills.validate(mockRuntime, yes), true);
  assert.equal(await searchAgentnetSkills.validate(mockRuntime, no), false);
});
