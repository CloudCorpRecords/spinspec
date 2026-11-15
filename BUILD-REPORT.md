# BUILD REPORT — spinspec

Clean-room rebuild of `com.dolphincentrifuge/centrifuge` v1.0.0 (remote-only MCP server at `https://dolphincentrifuge.com/mcp`), built 2026-10-28 as a forwarding client. Package: `@reneturcios/spinspec` 0.1.0, registry name `io.github.CloudCorpRecords/spinspec`.

## Surface built

Labelled subset: **4 of 5 captured tools built**, 1 omitted (see below).

| Tool | Required fields as served |
|------|-----------------------------|
| `get_centrifuge_specs` | none — no `required` key in the capture |
| `list_centrifuge_models` | none — no `required` key in the capture |
| `check_dolphin_stock` | none — no `required` key in the capture |
| `size_centrifuge` | none — no `required` key in the capture |

No captured tool carries a `required` key, and none was invented; tests explicitly assert `"required" in inputSchema === false` for every served tool. Each served tool carries exactly the keys `name`, `title`, `description`, `inputSchema`, verbatim from the fixture. Tool literals were generated programmatically from `harness/fixtures/dolphincentrifuge-tools-original.json` by the generator script at `/tmp/b42-spinspec-gen.py` (parse + re-serialise, placeholder substitution into `src/forward.ts`) — never retyped. Tools are registered via the MCP SDK low-level Server API (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers), not McpServer+zod.

## Omission — `request_quote`

- OMITTED: `request_quote` (required in the capture: `name`, `company`, `email`, `message`). Its captured description states it sends a quote/information request to Dolphin Centrifuge sales on behalf of the user using their real name, company and email — PII lead routing (porefind precedent).
- It is NOT registered, does NOT appear in tools/list, and is NOT a CLI command.
- Absence assertions in `test/forward.test.ts`:
  - Registry level: `TOOL_NAMES` does not include it, no `TOOL_DEFS` entry carries its name, `TOOL_DEFS.length === 4`, and `isKnownTool("request_quote") === false`.
  - MCP layer: `handleCallTool` rejects it with McpError MethodNotFound before any network hop (upstream call count 0).
  - CLI level: `spinspec request_quote '{}'` prints Usage on stderr and exits 2.

## Fixture conflicts

**None.** The spec and the fixture agree on the four built tools, their descriptions, property shapes, and the absence of any `required` key.

## Labelled reconstructions

- Upstream endpoint pinned: `https://dolphincentrifuge.com/mcp`.
- Env override `DOLPHINCENTRIFUGE_MCP_URL` — labelled reconstruction.
- No authentication header is ever sent: the registry record declares no headers and the capture was taken keyless. Tests assert no `Authorization` or `X-API-Key` header is sent on any upstream request.
- Error rendering `spinspec error:` text for upstream failures — labelled reconstruction.
- Upstream results pass through verbatim, including `isError` and extra fields. tools/call is forwarded as streamable-HTTP JSON-RPC: initialize (protocolVersion `2025-03-26`) → notifications/initialized → tools/call, honouring `Mcp-Session-Id` when issued; plain-JSON and SSE replies are both parsed. The forwarding core takes an injectable fetch; tests stub the upstream — no live network calls in tests.

## Deviations

None.

## Lockfile

- Route: generated clean from birth in the build dir with no `node_modules` and no pre-existing lockfile: `npm install --package-lock-only --ignore-scripts --offline`.
- Parses as JSON; `name` == `@reneturcios/spinspec`.
- Package entries: **128**.
- sha256: `860e74375d20e935da2a17c0f891ec8734d90c6a3a2bedef3895fdd8aa8b8d54` (re-verified unchanged after the subsequent offline `npm install`).

## server.json

- Description exactly: "Centrifuge specs, stock and RCF sizing for remanufactured Alfa Laval centrifuges." — **81 characters**.
- npm package entry carries `"version": "0.1.0"`; the OCI entry (`ghcr.io/cloudcorprecords/spinspec:0.1.0`) carries **no** `version` field. Both entries carry `packageArguments [{type: positional, value: mcp}]` and transport stdio. Repository: github `CloudCorpRecords/spinspec`.
- Dockerfile (node:20-alpine, both stages) has `ENTRYPOINT ["node","/app/dist/cli.js"]`, `CMD ["mcp"]`, and label `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/spinspec"`. Container workflow `IMAGE` is `ghcr.io/cloudcorprecords/spinspec` and its smoke test asserts the server name `spinspec`.

## Verification (all run 2026-10-28, foreground, from disk)

1. `npx tsc --noEmit` → exit 0.
2. `npm run build` → exit 0; real `dist/` produced.
3. `node dist/cli.js --version` → `0.1.0`.
4. `npm test` → **47 tests, 47 pass, 0 fail** (registration-integrity deep-equal vs the fixture's 4 tools in order, no-required assertions, omission absence at registry/MCP/CLI levels, session handling/reuse, env override, no-auth-header assertion, verbatim argument forwarding, result pass-through including upstream isError, SSE parsing, error rendering, MCP-layer validation, CLI behaviour).
5. Parity: `python3 /home/hatch/workspace/mcp-rebuild-100/harness/parity.py --original /home/hatch/workspace/mcp-rebuild-100/harness/fixtures/dolphincentrifuge-tools-original.json --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/spinspec/dist/cli.js mcp" --out /home/hatch/workspace/mcp-rebuild-100/builds/spinspec/parity-out` → **verdict PASS, parity 100.0** (4/4 identical, 0 missing, 0 extra, no schema diffs). Output in `parity-out/`.
