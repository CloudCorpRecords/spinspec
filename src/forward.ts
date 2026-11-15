/**
 * spinspec forwarding core.
 *
 * This package holds no centrifuge catalogue of its own.
 * It serves a captured tool surface locally for tools/list
 * and forwards each tools/call to the Dolphin Centrifuge
 * remote over streamable HTTP. A session is opened lazily:
 * initialize, then notifications/initialized, then the
 * call itself. When the upstream returns an Mcp-Session-Id
 * header the client reuses it for subsequent requests.
 *
 * Upstream: https://dolphincentrifuge.com/mcp
 * Override: DOLPHINCENTRIFUGE_MCP_URL (labelled reconstruction).
 * No authentication header is ever sent: the registry
 * record declares none and the capture was taken keyless.
 *
 * Upstream results are returned exactly as received,
 * including any isError flag. Transport or protocol
 * failures become isError results whose text starts with
 * `spinspec error:` (labelled reconstruction). Replies
 * may arrive as plain JSON or as SSE data lines.
 *
 * LABELLED SUBSET: 4 of 5 captured tools are built.
 * request_quote is omitted and never registered.
 */
import type { FetchFn, FetchResponseLike, ForwardDeps, ToolArgs, ToolDef, ToolResult } from "./types.js";

export const VERSION = "0.1.0";
export const DEFAULT_ENDPOINT_URL = "https://dolphincentrifuge.com/mcp";
export const DEFAULT_TIMEOUT_MS = 30000;
export const PROTOCOL_VERSION = "2025-03-26";

// Tool literals generated programmatically from the fixture
// harness/fixtures/dolphincentrifuge-tools-original.json
// (parsed and re-serialised; never retyped by hand).
export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "get_centrifuge_specs",
    "title": "Get centrifuge specs",
    "description": "Published specifications for an Alfa Laval disc stack or decanter centrifuge (or Dolphin DMPX/DMB module) remanufactured by Dolphin Centrifuge. Pass an exact model such as \"MOPX 207\" or a free-text query such as \"diesel self-cleaning\". Capacities always come with their fluid and conditions.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "model": {
          "type": "string",
          "maxLength": 80,
          "description": "Model designation, alias or Dolphin module, e.g. \"MOPX 207\", \"WHPX 405\", \"DMPX-028\", \"NX 418\"."
        },
        "query": {
          "type": "string",
          "maxLength": 200,
          "description": "Free-text search when the exact model is unknown, e.g. \"decanter 418\" or \"turbine oil\"."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "list_centrifuge_models",
    "title": "List centrifuge models",
    "description": "List the centrifuge models Dolphin publishes specs for, one line each, optionally filtered by type and by application/fluid keyword.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "disc stack",
            "decanter"
          ],
          "description": "Machine type."
        },
        "application": {
          "type": "string",
          "maxLength": 200,
          "description": "Fluid or application keyword, e.g. \"diesel\", \"lube oil\", \"coolant\", \"wastewater\"."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "check_dolphin_stock",
    "title": "Check Dolphin stock",
    "description": "Dated list of Alfa Laval centrifuges in stock at Dolphin Centrifuge (Warren, Michigan): model, type, condition and whether the unit is in stock or built to order. No prices or serial numbers.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "model": {
          "type": "string",
          "maxLength": 80,
          "description": "Optional model or family filter, e.g. \"MOPX 207\" or \"WHPX\". Omit for the full list."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "size_centrifuge",
    "title": "RCF / RPM sizing",
    "description": "Relative centrifugal force (g-force) calculator using RCF = 1.118e-5 x r(cm) x RPM^2. Give any two of bowl_diameter_m, rpm, g_force and get the third plus basic separation guidance.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bowl_diameter_m": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 3,
          "description": "Bowl inside diameter in meters, e.g. 0.36."
        },
        "rpm": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 30000,
          "description": "Bowl speed in revolutions per minute."
        },
        "g_force": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 100000,
          "description": "Relative centrifugal force, x g."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

function errorResult(detail: string): ToolResult {
  return { content: [{ type: "text", text: `spinspec error: ${detail}` }], isError: true };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

export function parseRpcBody(text: string, expectedId?: number): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch { /* skip non-JSON candidate */ }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

export class SpinspecClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) { this.deps = deps; }

  private fetchFn(): FetchFn { return this.deps.fetchFn ?? defaultFetch; }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).DOLPHINCENTRIFUGE_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) return this.deps.timeoutMs;
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number { this.idCounter += 1; return this.idCounter; }

  private async post(body: unknown, withSession: boolean): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (withSession && this.sessionId !== null) headers["Mcp-Session-Id"] = this.sessionId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    } finally { clearTimeout(timer); }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post({ jsonrpc: "2.0", id: initId, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "spinspec", version: VERSION } } }, false);
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) throw new Error(rpcErrorMessage(initParsed.error));
        if (initRes.status < 200 || initRes.status >= 300) throw new Error(`HTTP ${initRes.status}`);
        if (initParsed === null && initText.trim() !== "") throw new Error("malformed response");
        const initializedRes = await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, true);
        try { await initializedRes.text(); } catch { /* ignore */ }
        this.ready = true;
      })();
    }
    try { await this.sessionPromise; } catch (err) { this.sessionPromise = null; this.sessionId = null; throw err; }
  }

  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try { await this.ensureSession(); } catch (err) { return errorResult(err instanceof Error ? err.message : String(err)); }
    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post({ jsonrpc: "2.0", id: callId, method: "tools/call", params: { name, arguments: args ?? {} } }, true);
    } catch (err) {
      return errorResult(`request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) return errorResult(rpcErrorMessage(parsed.error));
    if (callRes.status < 200 || callRes.status >= 300) return errorResult(`HTTP ${callRes.status}`);
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") return errorResult("malformed response");
    return result;
  }
}

export function createClient(deps: ForwardDeps = {}): SpinspecClient { return new SpinspecClient(deps); }

export async function callTool(name: string, args: ToolArgs, deps: ForwardDeps = {}): Promise<ToolResult> {
  return new SpinspecClient(deps).callTool(name, args);
}
