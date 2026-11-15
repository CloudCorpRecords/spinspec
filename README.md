# spinspec

Finding the right remanufactured centrifuge starts with trustworthy numbers. spinspec is a local forwarding client for the Dolphin Centrifuge MCP service: it can pull published specifications for an Alfa Laval disc stack or decanter machine, list the models Dolphin publishes, check which units are currently in stock at Warren, Michigan, and run the RCF/RPM sizing calculation that ties bowl diameter, speed and g-force together.

No catalogue lives in this package. `tools/list` is answered locally from a captured definition set, and every `tools/call` is forwarded upstream over a streamable-HTTP JSON-RPC session, with the result returned exactly as the service sent it.

This is a labelled subset rebuild. The capture enumerates five tools and four are built here. `request_quote` is omitted: its captured description says it sends the user's real name, company and email to the vendor's sales team, so it is not registered, not listed, and not available from the CLI.

## The tools

- **`get_centrifuge_specs`** — Published specifications for a remanufactured Alfa Laval disc stack or decanter centrifuge, or a Dolphin DMPX/DMB module. Pass an exact `model` such as "MOPX 207", or a free-text `query` when the model is unknown.
- **`list_centrifuge_models`** — The models Dolphin publishes specs for, optionally filtered by `type` ("disc stack" or "decanter") and by an `application` keyword.
- **`check_dolphin_stock`** — A dated stock list, optionally filtered by `model` or family. No prices or serial numbers.
- **`size_centrifuge`** — RCF sizing using RCF = 1.118e-5 x r(cm) x RPM^2. Give any two of `bowl_diameter_m`, `rpm` and `g_force` and get the third, plus separation guidance.

None of the four tools requires any argument; every field is optional in the captured schemas, and no `required` key has been added.

## Install and run

```bash
npx -y @reneturcios/spinspec mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "spinspec": {
      "command": "npx",
      "args": ["-y", "@reneturcios/spinspec", "mcp"]
    }
  }
}
```

Container:

```bash
docker run -i ghcr.io/cloudcorprecords/spinspec
docker run --rm ghcr.io/cloudcorprecords/spinspec size_centrifuge '{"rpm":8000,"bowl_diameter_m":0.36}'
```

## CLI

```bash
spinspec get_centrifuge_specs '{"model":"MOPX 207"}'
spinspec list_centrifuge_models '{"type":"disc stack"}'
spinspec check_dolphin_stock '{}'
spinspec size_centrifuge '{"rpm":8000,"bowl_diameter_m":0.36}'
spinspec --version
```

Exit codes: `0` on success, `1` when the forwarded result is an error, `2` for usage errors such as an unknown subcommand or malformed JSON.

## Configuration

- `DOLPHINCENTRIFUGE_MCP_URL` — Overrides the upstream endpoint, which otherwise defaults to `https://dolphincentrifuge.com/mcp`. (This override is a reconstruction added by the rebuild.)

No authentication header is ever sent. The registry record declares no headers for this remote and the tool surface was captured without a key.

Failures from upstream — a JSON-RPC error, a non-2xx status, an unreadable body, or a failed request — surface as an error result whose text begins with `spinspec error:`.

## How forwarding works

The first call opens a session with an `initialize` request (protocol version `2025-03-26`), followed by `notifications/initialized`, then the `tools/call`. An `Mcp-Session-Id` header issued by the service is carried on later requests and the session is reused for the life of the process. Replies may be plain JSON or server-sent events. Successful results pass through verbatim, including any `isError` flag and extra fields.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

Tests run against a stubbed JSON-RPC upstream with no live network. They check the served list against the captured fixture, assert `request_quote` is absent at registry, MCP and CLI levels, and cover session handling, the env override, the no-auth-header guarantee, verbatim forwarding, result pass-through including upstream errors, SSE parsing, and error rendering.

## License

MIT — see `LICENSE`. Copyright (c) 2026 Rene Turcios.
