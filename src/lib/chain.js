/**
 * Minimal mainnet READ against a public Solana RPC: resolve an AgentNet item
 * mint to its inscription signature. AgentNet mints are Token-2022 with a
 * tokenMetadata extension whose `uri` is built by itemMetadataUri() in
 * AgentNet packages/core/src/core/chain.ts as
 * `<gateway>/skill/<mint>/<sig>`, so the last path segment IS the code-in
 * tx signature the gateway serves under /data/<sig>. jsonParsed encoding
 * surfaces the extension without any Token-2022 client dependency.
 * Read-only: getAccountInfo costs nothing and signs nothing.
 */

export const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

/** Default deadline for read-tier HTTP. Without one, a tarpitting endpoint
 *  (observed live in the api.mainnet-beta.solana.com DNS pool) stalls the
 *  action for undici's 300s headers timeout, or indefinitely on a trickling
 *  body. Callers may still pass their own AbortSignal. */
export const READ_TIMEOUT_MS = 30_000;

/** Read a mint's Token-2022 tokenMetadata via getAccountInfo(jsonParsed).
 *  Returns { name, uri, sig } where sig is the inscription tx signature. */
export async function fetchMintMetadata(rpcUrl, mint, { signal } = {}) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [mint, { encoding: "jsonParsed" }],
    }),
    signal: signal ?? AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`agentnet rpc: HTTP ${res.status} from ${rpcUrl}`);
  const json = await res.json();
  if (json.error) throw new Error(`agentnet rpc: ${json.error.message ?? "RPC error"}`);
  const info = json.result?.value?.data?.parsed?.info;
  const ext = info?.extensions?.find((e) => e.extension === "tokenMetadata");
  if (!ext) throw new Error(`mint ${mint}: no Token-2022 tokenMetadata extension (not an AgentNet item?)`);
  const { name, uri } = ext.state ?? {};
  const sig = String(uri ?? "").split("/").filter(Boolean).pop();
  if (!sig || sig.length < 43) throw new Error(`mint ${mint}: metadata uri "${uri}" has no inscription signature`);
  return { name: name ?? "", uri, sig };
}
