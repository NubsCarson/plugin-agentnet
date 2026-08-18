/**
 * Minimal MCP stdio client for the published @iqlabs-official/agentnet-mcp
 * server. Speaks the stdio transport's newline-delimited JSON-RPC 2.0
 * framing (same framing the server's bundled @modelcontextprotocol/sdk
 * StdioServerTransport reads): initialize handshake, then tools/list and
 * tools/call. No SDK dependency; the transport is injectable so tests run a
 * recording stub with no child process.
 */
import { spawn } from "node:child_process";

export const AGENTNET_MCP_PACKAGE = "@iqlabs-official/agentnet-mcp";
export const MCP_PROTOCOL_VERSION = "2025-06-18";
const STDERR_TAIL_MAX = 4096;

/** Transport that spawns the server process and frames messages over its
 *  stdio. `command`/`args` default to the npx spawn the server's README
 *  documents. */
export class StdioProcTransport {
  #child = null;
  #buf = "";
  #stderr = "";

  constructor({ command = "npx", args = ["-y", AGENTNET_MCP_PACKAGE], env = {} } = {}) {
    this.command = command;
    this.args = args;
    this.env = env;
  }

  /** Spawn and start reading. onMessage(msg) per parsed JSON-RPC message;
   *  onClose(err) once when the process exits or fails to spawn. */
  start(onMessage, onClose) {
    this.#child = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => {
      this.#buf += chunk;
      let nl;
      while ((nl = this.#buf.indexOf("\n")) >= 0) {
        const line = this.#buf.slice(0, nl).trim();
        this.#buf = this.#buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // not JSON-RPC; the server only writes protocol frames to stdout
        }
        onMessage(msg);
      }
    });
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk) => {
      this.#stderr = (this.#stderr + chunk).slice(-STDERR_TAIL_MAX);
    });
    this.#child.on("error", (err) => onClose(err));
    this.#child.on("exit", (code) =>
      onClose(new Error(`agentnet-mcp exited (code ${code}). stderr: ${this.#stderr.trim()}`)),
    );
  }

  send(msg) {
    if (!this.#child) throw new Error("transport not started");
    this.#child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  close() {
    try {
      this.#child?.kill();
    } catch {
      // already gone
    }
  }
}

/** JSON-RPC client over any transport with start/send/close. */
export class McpClient {
  #transport;
  #nextId = 1;
  #pending = new Map();
  #closed = null;
  #timeoutMs;

  constructor(transport, { timeoutMs = 120_000 } = {}) {
    this.#transport = transport;
    this.#timeoutMs = timeoutMs;
    this.serverInfo = null;
    this.onClose = null;
  }

  /** Start the transport and run the MCP initialize handshake. */
  async connect() {
    this.#transport.start(
      (msg) => this.#onMessage(msg),
      (err) => this.#onClosed(err),
    );
    const init = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "plugin-agentnet", version: "0.1.0" },
    });
    this.serverInfo = init?.serverInfo ?? null;
    this.notify("notifications/initialized");
    return init;
  }

  request(method, params = {}) {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      timer.unref?.();
      this.#pending.set(id, { resolve, reject, timer });
      this.#transport.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params) {
    this.#transport.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  async listTools() {
    const res = await this.request("tools/list", {});
    return res?.tools ?? [];
  }

  /** tools/call. Returns the MCP result ({ content, isError? }); protocol
   *  errors reject. */
  callTool(name, args = {}) {
    return this.request("tools/call", { name, arguments: args });
  }

  close() {
    this.#onClosed(new Error("client closed"));
    this.#transport.close();
  }

  #onMessage(msg) {
    if (msg?.id === undefined || !this.#pending.has(msg.id)) return; // server notification
    const { resolve, reject, timer } = this.#pending.get(msg.id);
    this.#pending.delete(msg.id);
    clearTimeout(timer);
    if (msg.error) reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    else resolve(msg.result);
  }

  #onClosed(err) {
    if (this.#closed) return;
    this.#closed = err ?? new Error("MCP transport closed");
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(this.#closed);
    }
    this.#pending.clear();
    this.onClose?.(this.#closed);
  }
}
