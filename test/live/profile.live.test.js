/**
 * Live-integration test for AGENTNET_PROFILE against the owner wallet
 * (3Bpjj..., creator of iq-onchain-db and create-new-db). Reads the real
 * gateway /user routes and the indexer catalog; no wallet, no writes. Run
 * via `npm run test:live`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentnetProfile } from "../../src/actions/profile.js";

const OWNER = "3BpjjjJujk6qsG6rRLdiR3Wfsgh3SdhyJ83W46VUyc3Q";
const mockRuntime = { getSetting: () => undefined }; // defaults: live gateway + indexer

test("live: owner wallet profile lists its created items and posts", async () => {
  const message = { content: { text: `show the agentnet profile for ${OWNER}` } };
  const delivered = [];
  const callback = async (content) => {
    delivered.push(content);
    return [];
  };
  const result = await agentnetProfile.handler(mockRuntime, message, undefined, undefined, callback);
  assert.equal(result.success, true, `profile failed: ${result.text}`);
  assert.match(result.text, new RegExp(`AgentNet profile for ${OWNER}`));
  assert.match(result.text, /iq-onchain-db/, "owner's published skill should appear");
  assert.match(result.text, /create-new-db/, "owner's published workflow should appear");
  assert.ok(result.data.posts >= 2, `owner has at least 2 indexed posts, got ${result.data.posts}`);
  assert.ok(
    result.data.created.some((it) => it.mint.startsWith("HmVGfSDT")),
    "created items should include the iq-onchain-db mint",
  );
  assert.equal(delivered.length, 1);
});
