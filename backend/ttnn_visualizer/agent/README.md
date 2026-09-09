# Agent tools (MCP) — developer notes

User-facing documentation is [`docs/src/agent-tools.md`](../../../docs/src/agent-tools.md):
what the tools answer, what the numbers mean, and how to register the server with a
client. Read that first. The conventions this package holds to are in
[CONVENTIONS.md](../../../CONVENTIONS.md#agent-facing-tools). Tracked in
[#1995](https://github.com/tenstorrent/ttnn-visualizer/issues/1995).

This file covers only what a person changing the code needs.

## Layout

| Module | Holds |
|---|---|
| `handles.py` | Path → handle registry, and the inventory `load_report` returns. No database and no app context: `Instance` is a plain model of two paths, which is what lets the tools read the query classes directly. |
| `tools.py` | The tools, `CANONICAL_PROJECTION`, and the caveat logic. |
| `server.py` | Newline-delimited JSON-RPC on stdio. Nothing above it imports from here. |

## Running it from a source checkout

```bash
uv run ttnn-visualizer-mcp
```

Drive it by hand with a here-doc, which is faster than attaching a client while iterating:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"load_report","arguments":{"performance_path":"/path/to/report"}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"zone_timings","arguments":{"handle":"report-1","limit":5}}}' \
  | uv run ttnn-visualizer-mcp
```

## Three things to know before editing

**`stdout` is protocol.** Logs go to stderr, and `tools._generate_canonical_report`
captures `tt_perf_report`'s own printing — it prints progress and temp paths, which would
land mid-frame and corrupt the stream.

**Report cells are strings.** `device_time` arrives as `"16.478"` and `cores` as `"110"`,
so everything numeric goes through `_as_number` rather than being compared directly.

**Adding a tool means adding it to `_tool_table`**, with a description carrying the caveats
an agent needs *before* choosing it — not only in the response.

## Swapping in the official SDK

The transport is hand-rolled to keep a resolver tree and a licence scan off a spike. The
replacement is contained to `server.py`: add `mcp` as an optional dependency, and re-express
`_tool_table` as SDK tool registrations. The tools themselves take a registry and plain
arguments, so they do not change.
