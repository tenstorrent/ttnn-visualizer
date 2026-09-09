<!--
SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
-->

# Agent tools (MCP)

TT-NN Visualizer ships a Model Context Protocol server so a coding agent can ask a
performance report the questions a person asks it during model bring-up: which operations
dominate, where the time went inside them, and whether a change helped.

It is a read-only surface over the same report readers the web application uses. It starts
no web server, opens no port, and writes nothing to a report.

## Running it

```bash
ttnn-visualizer-mcp
```

The server speaks newline-delimited JSON-RPC on stdin and stdout, which is what an MCP
client expects from a stdio server. Register it with your client the way you would any
other stdio MCP server — for Claude Code:

```bash
claude mcp add ttnn-visualizer -- ttnn-visualizer-mcp
```

Reports are addressed by path, not by the `instanceId` the web application uses, so the
server needs no database and no running application.

## The tools

| Tool | Answers |
|---|---|
| `load_report` | What this report contains, and which of the tools below apply to it. Returns a handle the others take. |
| `top_ops` | The costliest operations by device time, op-to-op gap, total percentage, FLOPS, DRAM bandwidth or core count. |
| `zone_timings` | Per-zone, per-RISC totals from `profile_log_device.csv` — firmware and kernel phases, as measured on device. |
| `diff_reports` | Per-operation-code deltas between two reports, largest movement first. |

Call `load_report` first. It reports what is answerable rather than making you discover it
one failed call at a time, because the report kinds are independent: a performance-only
capture has no operation graph and no tensor data, and a report with no device profiler log
cannot answer `zone_timings`.

## What the answers mean

Three properties are deliberate, and worth knowing before you act on a number.

**Every tool returns an aggregate or a bounded slice, never the table.** A performance
report runs to tens of thousands of rows of about thirty-five fields. Limits are capped
server-side, so asking for more returns the cap rather than the report.

**No rows are hidden from you.** The web application's performance view hides host
operations by default and can narrow to a signpost range. Those are display choices, and an
agent handed them unannounced would reason confidently about a partial set. The tools read
the report with host operations included, signpost markers kept, and no signpost range.

One filter is applied, deliberately: per-device rows are **merged**, so an operation that
ran on eight devices is one row rather than eight. That is the unit an operation is
reported in rather than a subset of the report — but it is a choice, so every response
repeats the projection it used and you can see it.

**A total on a partitioned run carries a caveat.** When a report spans more than one
sub-device, operations on different sub-devices can run concurrently, so summed device
time, total percentages and op-to-op gaps overstate elapsed time. Responses that include a
total say so, and name the sub-devices involved — `top_ops` and `diff_reports` alike, since
a delta between two unsound totals is unsound the same way.

Totals are only reported for metrics a sum means something for: device time, op-to-op gap
and total percentage. DRAM bandwidth, FLOPS and core count are per-operation figures, and
adding them across a report would produce a number that looks authoritative and is not.

`zone_timings` carries a caveat of its own: cycles are summed across every core that ran
the zone, so they measure occupancy rather than wall-clock duration. A core is counted per
device — the captures we test against span 8 and 32 PCIe slots, and coordinates alone
repeat on each — so a zone can report thousands of cores on a multi-device run. Durations
need the device log's `type` column to pair zone starts with ends; a capture without it
reports occurrence counts only, and a capture that stopped mid-zone reports how many starts
and ends failed to pair so a partial total does not read as a complete one.

## Limitations

Device profiler logs carry named zones only where a kernel was instrumented to emit them.
Most captures contain only the default firmware and kernel zones — `BRISC-FW`,
`BRISC-KERNEL` and the same pair for `NCRISC` and `TRISC`, plus `ERISC` where a capture
used ethernet cores — so on those reports `zone_timings` describes RISC-level phases rather
than named model operations. A capture whose kernels do emit named zones reports them
alongside the defaults.

The transport is a minimal JSON-RPC implementation rather than the official MCP SDK, which
keeps the server free of additional dependencies while the tool set settles.
