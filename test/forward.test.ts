import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  SpinspecClient,
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  isKnownTool,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type { FetchFn, FetchResponseLike, ToolDef, ToolResult } from "../src/types.js";

const FIXTURE_URL = new URL("../../../harness/fixtures/dolphincentrifuge-tools-original.json", import.meta.url);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}


const ALL_TOOLS = ["get_centrifuge_specs", "list_centrifuge_models", "check_dolphin_stock", "size_centrifuge"];
const OMITTED = "request_quote";
const SPECS = "get_centrifuge_specs";
const SAMPLE_RESULT = { content: [{ type: "text", text: "MOPX 207 specs" }], structuredContent: { model: "MOPX 207" } };
const SAMPLE_ARGS = { model: "MOPX 207" };

interface Captured { url: string; headers: Record<string, string>; body: Record<string, unknown>; }
interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(status: number, bodyText: string, headers: Record<string, string> = {}): FetchResponseLike {
  const lowered = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => lowered.get(n.toLowerCase()) ?? null }, text: async () => bodyText };
}
function jsonResponse(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return makeResponse(status, JSON.stringify(payload), headers);
}
function makeUpstream(options: FakeOptions = {}): { fetchFn: FetchFn; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initError !== undefined) return jsonResponse(200, { jsonrpc: "2.0", id: body.id, error: options.initError });
      const headers: Record<string, string> = {};
      const sessionId = options.sessionId === undefined ? "sess-abc" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(200, { jsonrpc: "2.0", id: body.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, serverInfo: { name: "centrifuge", version: "1.0.0" } } }, headers);
    }
    if (method === "notifications/initialized") return makeResponse(202, "");
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) { reject(new Error("aborted")); return; }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) return makeResponse(options.callStatus ?? 200, options.callBodyText);
      if (options.callError !== undefined) return jsonResponse(200, { jsonrpc: "2.0", id: body.id, error: options.callError });
      const result = options.callResult ?? SAMPLE_RESULT;
      const payload = { jsonrpc: "2.0", id: body.id, result };
      if (options.sse) return makeResponse(200, `event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      return jsonResponse(options.callStatus ?? 200, payload);
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}
function stubClient(options: FakeOptions = {}, extra: Record<string, unknown> = {}) {
  const upstream = makeUpstream(options);
  const c = new SpinspecClient({ fetchFn: upstream.fetchFn, env: {}, ...extra });
  return { client: c, calls: upstream.calls };
}
function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}
function methods(calls: Captured[]): string[] { return calls.map((c) => c.body.method as string); }
function schemaOf(tool: ToolDef): Record<string, any> { return tool.inputSchema as Record<string, any>; }

describe("registration integrity", () => {
  it("serves exactly the fixture's 4 tools, deep-equal, in order", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 4);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });
  it("serves tool names in fixture order", () => { assert.deepEqual(TOOL_NAMES, ALL_TOOLS); });
  it("no tool carries a required key", () => {
    for (const tool of TOOL_DEFS) {
      assert.equal("required" in schemaOf(tool), false);
      assert.equal(schemaOf(tool).required, undefined);
    }
  });
  it("each tool carries exactly name/title/description/inputSchema", () => {
    for (const tool of TOOL_DEFS) assert.deepEqual(Object.keys(tool).sort(), ["description", "inputSchema", "name", "title"]);
  });
  it("inputSchemas carry object type, additionalProperties false and $schema", () => {
    for (const tool of TOOL_DEFS) {
      assert.equal(schemaOf(tool).type, "object");
      assert.equal(schemaOf(tool).additionalProperties, false);
      assert.equal(schemaOf(tool)["$schema"], "http://json-schema.org/draft-07/schema#");
    }
  });
  it("carries properties in fixture order per tool", () => {
    assert.deepEqual(Object.keys(schemaOf(TOOL_DEFS[0]).properties), ["model", "query"]);
    assert.deepEqual(Object.keys(schemaOf(TOOL_DEFS[1]).properties), ["type", "application"]);
    assert.deepEqual(Object.keys(schemaOf(TOOL_DEFS[2]).properties), ["model"]);
    assert.deepEqual(Object.keys(schemaOf(TOOL_DEFS[3]).properties), ["bowl_diameter_m", "rpm", "g_force"]);
  });
  it("size_centrifuge numeric bounds are verbatim", () => {
    const props = schemaOf(TOOL_DEFS[3]).properties;
    assert.equal(props.rpm.maximum, 30000);
    assert.equal(props.g_force.maximum, 100000);
    assert.equal(props.bowl_diameter_m.maximum, 3);
  });
  it("list_centrifuge_models enum is verbatim", () => {
    assert.deepEqual(schemaOf(TOOL_DEFS[1]).properties.type.enum, ["disc stack", "decanter"]);
  });
  it("isKnownTool recognises built tools and rejects others", () => {
    for (const n of ALL_TOOLS) assert.equal(isKnownTool(n), true);
    assert.equal(isKnownTool(""), false);
    assert.equal(isKnownTool("get_specs"), false);
  });
});

describe("labelled omission: request_quote is absent", () => {
  it("not in served names or defs (registry level)", () => {
    assert.equal(TOOL_NAMES.includes(OMITTED), false);
    assert.equal(TOOL_DEFS.some((t) => t.name === OMITTED), false);
    assert.equal(TOOL_DEFS.length, 4);
  });
  it("isKnownTool rejects it (registry level)", () => { assert.equal(isKnownTool(OMITTED), false); });
  it("MCP layer rejects it as unknown before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, OMITTED, { name: "x", company: "y", email: "a@b.c", message: "hi" }),
      (err: unknown) => err instanceof McpError && err.code === ErrorCode.MethodNotFound,
    );
    assert.equal(upstream.calls.length, 0);
  });
});

describe("session handling", () => {
  it("runs initialize, notifications/initialized, then tools/call", async () => {
    const { client: c, calls } = stubClient();
    const out = await c.callTool(SPECS, SAMPLE_ARGS);
    assert.equal(out.isError, undefined);
    assert.deepEqual(methods(calls), ["initialize", "notifications/initialized", "tools/call"]);
    assert.ok(calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
    assert.equal(DEFAULT_ENDPOINT_URL, "https://dolphincentrifuge.com/mcp");
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-abc");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-abc");
  });
  it("sends clientInfo spinspec and protocol 2025-03-26 on initialize", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SPECS, SAMPLE_ARGS);
    const p = calls[0].body.params as Record<string, unknown>;
    assert.equal(p.protocolVersion, "2025-03-26");
    assert.equal(PROTOCOL_VERSION, "2025-03-26");
    assert.deepEqual(p.clientInfo, { name: "spinspec", version: VERSION });
  });
  it("reuses session on later calls", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SPECS, SAMPLE_ARGS);
    await c.callTool("size_centrifuge", { rpm: 8000, bowl_diameter_m: 0.36 });
    assert.deepEqual(methods(calls), ["initialize", "notifications/initialized", "tools/call", "tools/call"]);
  });
  it("sends no session header when upstream issues none", async () => {
    const { client: c, calls } = stubClient({ sessionId: null });
    await c.callTool(SPECS, SAMPLE_ARGS);
    assert.ok(calls.every((call) => call.headers["Mcp-Session-Id"] === undefined));
  });
  it("honours DOLPHINCENTRIFUGE_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = new SpinspecClient({ fetchFn: upstream.fetchFn, env: { DOLPHINCENTRIFUGE_MCP_URL: "https://staging.example.com/mcp" } });
    await c.callTool(SPECS, SAMPLE_ARGS);
    assert.ok(upstream.calls.every((call) => call.url === "https://staging.example.com/mcp"));
  });
  it("honours explicit url override over env", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: { DOLPHINCENTRIFUGE_MCP_URL: "https://env.example.com/mcp" }, url: "https://explicit.example.com/mcp" });
    await c.callTool(SPECS, SAMPLE_ARGS);
    assert.ok(upstream.calls.every((call) => call.url === "https://explicit.example.com/mcp"));
  });
  it("falls back to pinned endpoint when env override is blank", async () => {
    const upstream = makeUpstream();
    const c = new SpinspecClient({ fetchFn: upstream.fetchFn, env: { DOLPHINCENTRIFUGE_MCP_URL: "   " } });
    await c.callTool(SPECS, SAMPLE_ARGS);
    assert.ok(upstream.calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
  });
});

describe("no auth headers", () => {
  it("never sends Authorization or X-API-Key", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SPECS, SAMPLE_ARGS);
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined));
    assert.ok(calls.every((call) => call.headers["X-API-Key"] === undefined));
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined && !("x-api-key" in call.headers)));
  });
  it("sends only content headers plus session id", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SPECS, SAMPLE_ARGS);
    for (const call of calls) {
      assert.equal(call.headers["Content-Type"], "application/json");
      assert.equal(call.headers["Accept"], "application/json, text/event-stream");
    }
  });
});

describe("tools/call forwarding", () => {
  it("forwards arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SPECS, SAMPLE_ARGS);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SPECS);
    assert.deepEqual(params.arguments, SAMPLE_ARGS);
  });
  it("forwards each built tool under its own name", async () => {
    for (const name of ALL_TOOLS) {
      const upstream = makeUpstream();
      const out = await callTool(name, {}, { fetchFn: upstream.fetchFn, env: {} });
      assert.equal(out.isError, undefined);
      const params = upstream.calls[2].body.params as Record<string, unknown>;
      assert.equal(params.name, name);
    }
  });
  it("passes upstream result through verbatim including extra fields", async () => {
    const { client: c } = stubClient();
    assert.deepEqual(await c.callTool(SPECS, SAMPLE_ARGS), SAMPLE_RESULT);
  });
  it("passes upstream isError through untouched", async () => {
    const r = { content: [{ type: "text", text: "unknown model" }], isError: true };
    const { client: c } = stubClient({ callResult: r });
    assert.deepEqual(await c.callTool(SPECS, { model: "nope" }), r);
  });
  it("reads SSE-framed response", async () => {
    const { client: c } = stubClient({ sse: true });
    assert.deepEqual(await c.callTool(SPECS, SAMPLE_ARGS), SAMPLE_RESULT);
  });
});

describe("failures render as spinspec error text", () => {
  it("maps JSON-RPC error", async () => {
    const { client: c } = stubClient({ callError: { code: -32000, message: "upstream failed" } });
    const out = await c.callTool(SPECS, SAMPLE_ARGS);
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "spinspec error: upstream failed");
  });
  it("maps initialize JSON-RPC error", async () => {
    const { client: c } = stubClient({ initError: { code: -32600, message: "bad initialize" } });
    const out = await c.callTool(SPECS, SAMPLE_ARGS);
    assert.equal(textOf(out), "spinspec error: bad initialize");
  });
  it("maps unparseable response to malformed", async () => {
    const { client: c } = stubClient({ callBodyText: "<html>oops</html>" });
    const out = await c.callTool(SPECS, SAMPLE_ARGS);
    assert.equal(textOf(out), "spinspec error: malformed response");
  });
  it("maps non-2xx to HTTP error", async () => {
    const { client: c } = stubClient({ callBodyText: "err", callStatus: 500 });
    const out = await c.callTool(SPECS, SAMPLE_ARGS);
    assert.equal(textOf(out), "spinspec error: HTTP 500");
  });
  it("maps throwing fetch", async () => {
    const { client: c } = stubClient({ throwOn: "tools/call" });
    const out = await c.callTool(SPECS, SAMPLE_ARGS);
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^spinspec error: /);
  });
  it("maps throwing initialize fetch", async () => {
    const { client: c } = stubClient({ throwOn: "initialize" });
    const out = await c.callTool(SPECS, SAMPLE_ARGS);
    assert.equal(textOf(out), "spinspec error: socket hang up");
  });
  it("maps timed-out call", async () => {
    const { client: c } = stubClient({ hangOnCall: true }, { timeoutMs: 20 });
    const out = await c.callTool(SPECS, SAMPLE_ARGS);
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^spinspec error: /);
  });
});

describe("parseRpcBody", () => {
  it("parses plain JSON by id", () => {
    assert.deepEqual(parseRpcBody('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}', 7), { jsonrpc: "2.0", id: 7, result: { ok: true } });
  });
  it("parses SSE and picks matching id", () => {
    const body = 'data: {"jsonrpc":"2.0","id":1,"result":{"n":1}}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"n":2}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), { jsonrpc: "2.0", id: 2, result: { n: 2 } });
  });
  it("ignores [DONE] and returns null for junk", () => {
    assert.deepEqual(parseRpcBody('data: {"jsonrpc":"2.0","id":4,"result":{"ok":true}}\ndata: [DONE]\n', 4), { jsonrpc: "2.0", id: 4, result: { ok: true } });
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json"), null);
  });
});

describe("MCP layer validation", () => {
  it("rejects unknown tool with MethodNotFound, no network", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(() => handleCallTool(c, "not_a_tool", {}), (e: unknown) => e instanceof McpError && e.code === ErrorCode.MethodNotFound);
    assert.equal(upstream.calls.length, 0);
  });
  it("rejects array arguments with InvalidParams", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(() => handleCallTool(c, SPECS, ["x"]), (e: unknown) => e instanceof McpError && e.code === ErrorCode.InvalidParams);
    assert.equal(upstream.calls.length, 0);
  });
  it("rejects string arguments with InvalidParams", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(() => handleCallTool(c, SPECS, "x"), (e: unknown) => e instanceof McpError && e.code === ErrorCode.InvalidParams);
  });
  it("forwards valid call unchanged and treats omitted args as {}", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    assert.deepEqual(await handleCallTool(c, SPECS, SAMPLE_ARGS), SAMPLE_RESULT);
    const upstream2 = makeUpstream();
    const c2 = createClient({ fetchFn: upstream2.fetchFn, env: {} });
    assert.deepEqual(await handleCallTool(c2, SPECS, undefined), SAMPLE_RESULT);
    assert.deepEqual((upstream2.calls[2].body.params as Record<string, unknown>).arguments, {});
  });
});

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], { cwd: root, encoding: "utf8", timeout: 30000 });
  }
  it("--version prints 0.1.0 exit 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
    assert.equal(res.stdout.trim(), VERSION);
  });
  it("-v prints 0.1.0", () => { const res = runCli(["-v"]); assert.equal(res.status, 0); assert.equal(res.stdout.trim(), "0.1.0"); });
  it("unknown command exits 2 with usage", () => { const res = runCli(["not-a-tool"]); assert.equal(res.status, 2); assert.match(res.stderr, /Usage:/); });
  it("omitted request_quote is not a CLI command and exits 2", () => { const res = runCli([OMITTED, "{}"]); assert.equal(res.status, 2); assert.match(res.stderr, /Usage:/); });
  it("non-JSON argument exits 2", () => { const res = runCli([SPECS, "not json"]); assert.equal(res.status, 2); });
  it("JSON array argument exits 2", () => { const res = runCli([SPECS, "[]"]); assert.equal(res.status, 2); });
  it("extra arguments after mcp exit 2", () => { const res = runCli(["mcp", "extra"]); assert.equal(res.status, 2); });
});
