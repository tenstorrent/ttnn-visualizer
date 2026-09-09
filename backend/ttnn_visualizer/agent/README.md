# Agent tools (MCP)

A stdio MCP server over the report readers, for an agent doing TT-NN bring-up.
Tracked in [#1995](https://github.com/tenstorrent/ttnn-visualizer/issues/1995).

## Running it

```bash
uv run ttnn-visualizer-mcp        # or: python -m ttnn_visualizer.agent.server
```

It speaks newline-delimited JSON-RPC on stdin/stdout. In a client's config:

```json
{
  "mcpServers": {
    "ttnn-visualizer": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/ttnn-visualizer", "ttnn-visualizer-mcp"]
    }
  }
}
```

## Tools

| Tool | Answers |
|---|---|
| `load_report` | What this report can be asked. Call first; returns the handle the rest take. |
| `top_ops` | Which ops dominate, by device time, op-to-op gap, total %, FLOPS, DRAM or cores. |
| `zone_timings` | Where the time went inside the device: per-zone, per-RISC totals from `profile_log_device.csv`. |
| `diff_reports` | Did my change help — per-op-code deltas between two reports. |

## Three rules the tools hold to

**Bounded results.** A perf report is 10⁴–10⁵ rows of ~35 fields. Every tool returns
an aggregate or a slice capped at `MAX_LIMIT`, never the table.

**A stated projection.** The HTTP route defaults to hiding host ops and merging
devices, and can narrow to a signpost range. Those are view choices; handed to an
agent unannounced they produce confident reasoning over a partial set. The tools
read with `CANONICAL_PROJECTION` and return it alongside the rows.

**Caveats travel with the number.** On a partitioned run, summed device time and
total percentages assume sequential execution. `tt-perf-report` warns about this and
the UI does not, so any tool returning a total says so.

## Notes

`stdout` is protocol only — logs go to stderr, and `tt_perf_report`'s own printing is
captured, since it would otherwise land mid-frame and corrupt the stream.

Zone cycles are summed across every core that ran the zone, so they measure occupancy
rather than elapsed time. Durations need the device log's `type` column to pair starts
with ends; a capture without it reports occurrence counts only.

The transport is hand-rolled to keep this dependency-free while it is a spike.
Swapping in the official `mcp` SDK touches only `server.py`.
