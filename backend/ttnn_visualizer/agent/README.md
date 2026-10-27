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
| `handles.py` | Path → handle registry, and the inventory and capture facts `load_report` returns. No app database and no app context: `Instance` is a plain model of two paths, which is what lets the tools read the query classes directly. It does open the report's own SQLite file read-only, to report what the report can answer and how many devices it holds, and reads the cluster descriptor's `arch` block. |
| `tools.py` | The performance-report tools, `CANONICAL_PROJECTION`, and the caveat logic. `with_signposts` adds the signposts and the perf CSV's device count to `load_report`'s answer, read in one pass through `csv_queries.resolve_signposts`. `program_cache` counts calls by `perf_flags.program_calls` and `perf_flags.repeat_cache_outcome`, the rule the `flags` group's recompute candidates read too. The two still differ by the flags' eligibility gate, as the view does: a repeat miss on a HOST-bound, signpost or missing row counts in `program_cache` and is never flagged. Its cache-disabled caveat is `perf_flags.CACHE_DISABLED_CAVEAT`, which the flags answer gives too. |
| `report_diff.py` | What `diff_reports` calls a change (#2155): the thresholds and each summable metric's floor, unit and caveat, a capture's group totals, the median of a side's captures, which list each group goes to (`classify`), and how a group and the facts the captures differ in are named. Pure; `tools.diff_reports` reads the reports, keeps each capture's totals per range and match (`CacheVariant.DIFF_TOTALS`, pinned in the registry since they are small), and refuses a capture given twice or a one-sided range. |
| `op_signatures.py` | An operation's tensor signature, from the performance CSV's `INPUT_n_*` and `OUTPUT_n_*` columns, for `diff_reports`' `match: signature` (#2155). Read apart from the generated report and only when asked, so no other tool's snapshot grows. It numbers rows as tt-perf-report's pandas read does, skipping an empty or whitespace-only line, since `diff_reports` finds a row's signature by the CSV position its report id names; the generator's own pass-through columns count such a line, which only a hand-edited CSV holds. |
| `perf_detail.py` | The field groups `include` adds to a performance row (#2153), and what fills a field no row carries. The generated rows hold the raw CSV columns behind them only because `tools` asks for `detail_columns`; the app's rows do not (#2159). |
| `operations.py` | The profiler-database tools, including provenance (arguments and call site). Opens its own read-only connection: `LocalQueryRunner` reads `Instance.profiler_path` as the SQLite file, while a handle holds the directory the caller named. |
| `linking.py` | The join from a performance row to the profiler operation that launched it: a port of the app's positional match (`src/functions/deviceOperationMatching.ts`). `TestMatcherParity` restates the app's cases, so it catches drift in the port only: **a change to the app's matcher or the order lists in `useAPI.tsx` fails nothing here and must be mirrored in `linking.py` by hand** (`isDeviceOperation` and the scope pairing are in `scope_outcomes.py`, below) — as must a change to `isCountableDeviceTime`, which `tools.countable_device_time` restates for `operation_detail`'s device-time shares. The only module reading both halves, so `tools` and `operations` never import each other; `server` routes `top_ops`, `program_cache` and `operation_detail` through it. |
| `failures.py` | `errors`, `dram_fallbacks` and `l1_peak` (#2154), and the error, fallback and circular buffers (#2185) `operation_detail` adds. Reads the database as `/api/operations`, `/api/operation-buffers` and `/api/devices` serve it, so the ports below get the inputs the app's functions get. |
| `allocation_failures.py`, `scope_outcomes.py`, `dram_fallbacks.py`, `l1_peak.py`, `circular_buffers.py` | Ports of the app's `parseAllocationFailure.ts`, `scopeOutcomes.ts` (with `getScopePairing` and `isDeviceOperation`), `getDramFallbacks.ts`, `l1PeakDecomposition.ts` with `resolveAddressLifetimes` and `getLastValidConsumer`, and the circular-buffer half of `processMemoryAllocations.ts` with `cbDeviceSlots.ts` and `getCoresInRangeList`. Which of those snapshots the app shows is decided inline in `DeviceOperationsFullRender.tsx`, so `circular_buffers.select_read` is held by `test_agent_circular_buffers.py` alone, as is `fold_devices`, which goes past the app: it folds the per-device sections an older mesh capture writes, which the app lists one per device. The port and the golden read a graph in raw capture order, where each device operation frees before it allocates; the guard #2185 added to `processMemoryAllocations` at a free-all is for callers that pass that order. The modal is not one: `OperationDetails.sortDeviceOperationsByBufferDeallocation` moves each scope's free-all after its buffers first, so the guard does not change what it shows. `test_agent_failure_parity.py` and `tests/agentFailureParity.spec.ts` share a golden of the ports' answers: their structured results, and which wording each diagnosis picks. A change to either side that alters those fails one of them; mirror it, then `pnpm run agent:parity-golden`. Both goldens are written and held through `tests/parity_golden.py`, which compares them as text too, since a `-0` the app's spec tells apart equals `0` as a value. The golden also holds the top-operations dedupe (`getTopL1PeakOperations`, `top_compositions`). `failures.py`'s reading of the database is not in it, so `test_agent_failures.py` holds that. Each TS function names its port. |
| `perf_flags.py` | The `flags` include group (#2193): a port of `annotatePerfHeuristicFlags` in `computePerfHeuristicFlags.ts`, with `getCoreUtilization`, `isSlowDramDominant`, `resolveMaxCores`, `getCoreCount`, `stringToArchitecture`, the thresholds in `PerfHeuristics.ts`, and the fields and first-call rule `enrichRowData` (`enrichPerfRowData.ts`) parses for them, less the allocation-failure and DRAM-fallback flags that `errors` and `dram_fallbacks` answer. `program_calls` restates the first-call rule and `repeat_cache_outcome` the repeat-call classification (`getRepeatCacheOutcome`), which the recompute-candidate flag, the app's table footer and `tools.program_cache` all count by. `test_agent_perf_flags_parity.py` and `tests/agentPerfFlagsParity.spec.ts` share a golden of its answers from the same report rows, so it holds the parse and the first-call rule as well as the thresholds; mirror a change to either side, then `pnpm run agent:parity-golden`, which regenerates both goldens. What the tools add around the port is not in it, so `test_agent_perf_flags.py` holds that: the device log and whole report `tools.read_flag_inputs` reads, `flagged_rows`, and the 1 ns placeholder (#2162) that `flag_fields` drops and the view does not. The device's core count comes from `DeviceLogProfilerQueries.read_device_meta`, the reader `/api/performance/device-log/meta` serves too (`test_device_log_meta.py`), so there is no second parse of the device log to mirror; it and `load_report` find the log through `DeviceLogProfilerQueries.device_log_path`. Each TS function names its port. |
| `app_links.py` | Links from an answer into the web application (#2047), at `TTNN_VISUALIZER_URL`, else `http://localhost:8000`. A link carries the report's directories, which the app opens through `POST /api/instance/local-paths`, so the server itself makes no request. The query parameters must match `src/libs/openReportFromLink.ts`; `test_agent_app_links_frontend_parity.py` holds them together. |
| `cells.py` | Reading a report cell as a number, for `tools` and `perf_detail` alike. |
| `bounds.py` | The result caps, a row cap and a lower one for rows with `include` fields, shared because `server` quotes them to an agent in every limit schema. Also the captured-graph guard (`MAX_CAPTURED_GRAPH_CHARS`, `ensure_graph_readable`, `GraphTooLargeError`) that the link and the failure tools check before a graph read. |
| `captured_graph.py` | Reading a captured graph's JSON into nodes (`parse_graph`, `UnreadableGraphError`) for the link, the failure tools and `circular_buffers` alike, with the `counter`-to-`id` rename `updateDeviceOperationId` applies in the app. |
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

The database tools take a profiler directory instead, and a report with both is loaded in
one call:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"load_report","arguments":{"profiler_path":"/path/to/profiler/report"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_profile","arguments":{"handle":"report-1","buffer_type":"L1","limit":5}}}' \
  | uv run ttnn-visualizer-mcp
```

## Three things to know before editing

**`stdout` is protocol.** Logs go to stderr, and `tools._generate_canonical_report`
captures `tt_perf_report`'s own printing — it prints progress and temp paths, which would
land mid-frame and corrupt the stream.

**Report cells are strings.** `device_time` arrives as `"16.478"` and `cores` as `"110"`,
so everything numeric goes through `cells.finite_number` rather than being compared
directly; it also drops a NaN or an infinity, which would reach the client as invalid JSON.

**The call-site parse has a second implementation.** `_parse_frames` must agree with
`src/functions/stackTraceSource.ts`, which takes the first `File "..."` and the first
`line N` for the operation details panel — two answers to "where is this op from" that
disagreed would be worse than one. `TestFrameParity` pins where they agree and, for the
inputs where the frontend's looser regexes answer differently, which answer this side
gives. They diverge only on a quote inside the path or the function name, which
CPython does not write for ordinary code; on 15,374 real traces there is no difference.

The frontend takes its file and its line number from two *separate* regexes over the
whole trace, so they need not come from the same frame, and it has a second input
(`stack_trace_source_file_id`) that has no equivalent here. Backend-owned parsing,
exposed to the frontend so those regexes can go, is the real fix — see #2013.

**Two size units share one response.** `buffers.max_size_per_bank` is per bank and
`tensors.size` is a whole-tensor byte count, so `operations.py` labels both rather than
letting the field names imply they are comparable. The HTTP serializers re-expose the
per-bank column as plain `size` (`serializers.py:309`), which is how easy the misreading
is.

**Adding a tool means adding it to `_tool_table`**, with a `title` and a description carrying
the caveats an agent needs *before* choosing it — not only in the response. A rule every tool
shares goes in `INSTRUCTIONS` instead, which clients put in the system prompt; keep it short.
It also means a row in the
tool table of [`docs/src/agent-tools.md`](../../../docs/src/agent-tools.md), in the same
change: that page is the only description of this surface a client's reader gets, and #2035
puts it inside the application, so a tool missing from it goes missing for the user too.

## Swapping in the official SDK

The transport is hand-rolled to keep a resolver tree and a licence scan off a spike. The
replacement is contained to `server.py`: add `mcp` as an optional dependency, and re-express
`_tool_table` as SDK tool registrations. The tools themselves take a registry and plain
arguments, so they do not change.
