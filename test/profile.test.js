/**
 * Offline tests for AGENTNET_PROFILE: wallet extraction, empty-profile
 * rendering, and the validate gate, no network. The live gateway/indexer
 * integration lives in test/live/profile.live.test.js.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentnetProfile, extractWallet, formatProfile } from "../src/actions/profile.js";

const OWNER = "3BpjjjJujk6qsG6rRLdiR3Wfsgh3SdhyJ83W46VUyc3Q";
const mockRuntime = { getSetting: () => undefined };

test("unit: extractWallet finds a base58 pubkey or nothing", () => {
  assert.equal(extractWallet(`profile for ${OWNER} on agentnet`), OWNER);
  assert.equal(extractWallet("agentnet profile please"), null);
});

test("unit: formatProfile renders empty-catalog wallets compactly", () => {
  const text = formatProfile(OWNER, { pubkey: OWNER }, { count: 0 }, []);
  assert.match(text, /Created items: none/);
  assert.match(text, /Posts: 0 inscription/);
});

test("unit: validate gates on profile wording plus a wallet", async () => {
  const yes = { content: { text: `show the agentnet profile for ${OWNER}` } };
  const noWallet = { content: { text: "show the agentnet profile" } };
  const noTrigger = { content: { text: `send 1 SOL to ${OWNER}` } };
  assert.equal(await agentnetProfile.validate(mockRuntime, yes), true);
  assert.equal(await agentnetProfile.validate(mockRuntime, noWallet), false);
  assert.equal(await agentnetProfile.validate(mockRuntime, noTrigger), false);
});
