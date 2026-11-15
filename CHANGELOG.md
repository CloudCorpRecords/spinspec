# Changelog

## 0.1.0 (2026-10-28)

- First release: a forwarding client for the Dolphin Centrifuge MCP remote. The four built captured tools are answered locally for tools/list, and every tools/call is forwarded upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring Mcp-Session-Id when issued).
- Tools: `get_centrifuge_specs`, `list_centrifuge_models`, `check_dolphin_stock`, `size_centrifuge`. None carries a `required` key, exactly as captured. This is a labelled subset of the captured 5-tool surface: `request_quote` is omitted because it submits the user's real name, company and email to the vendor's sales pipeline, and its absence is asserted in tests at registry, MCP and CLI levels.
- No authentication header is sent; the registry record declares none. Upstream results pass through verbatim, including isError; failures surface as `spinspec error:` text.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp`). The upstream endpoint can be overridden via `DOLPHINCENTRIFUGE_MCP_URL`.
