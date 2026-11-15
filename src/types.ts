/** Shared types for the spinspec forwarding client. */

export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  [key: string]: unknown;
}

export type ToolArgs = Record<string, unknown>;

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export interface ForwardDeps {
  fetchFn?: FetchFn;
  env?: Record<string, string | undefined>;
  url?: string;
  timeoutMs?: number;
}
