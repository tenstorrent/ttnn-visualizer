<!--
SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
-->

# Agent tools (MCP)

TT-NN Visualizer ships a Model Context Protocol server so a coding agent can ask a report
the questions a person asks it during model bring-up: which operations dominate, where the
time went inside them, whether a change helped, and what the run allocated.

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
| `find_operations` | Operations matching a name substring, with the ids `operation_detail` takes. |
| `operation_detail` | One operation: its input and output tensors with shape, dtype and layout, and what it had allocated. |
| `memory_profile` | Memory footprint per operation, keyed by buffer type and ranked within each, with each type's peak and the device's L1 geometry. |
| `tensor_flow` | Which operation produced a tensor and which ones consumed it. |

The first four read the performance CSVs; the last four read the profiler report's SQLite
database. A capture can carry either, both, or — as far as these tools are concerned —
neither, which is what makes `load_report`'s answer worth reading first.

Call `load_report` first. It reports what is answerable rather than making you discover it
one failed call at a time, because the report kinds are independent: a performance-only
capture has no operation graph and no tensor data, and a report with no device profiler log
cannot answer `zone_timings`. It checks that the profiler database is readable rather than
merely present, so a truncated capture is reported as unanswerable instead of failing four
calls later.

## What the answers mean

Five properties are deliberate, and worth knowing before you act on a number.

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

**Allocation figures are per bank, and nothing adds one memory type to another.**
`memory_profile` and the allocations in `operation_detail` come from the report's
`max_size_per_bank` column. That column is divided by the bank count of its own memory
type, and those counts differ — so a DRAM figure plus an L1 figure is two denominators in
one integer rather than a quantity. `memory_profile` therefore keys everything by buffer
type and ranks operations within a type, never across types.

A per-bank L1 figure is comparable to the `l1_bank_size` returned beside it, which is a
conservative bound. **A device-wide total cannot be derived from the response**, and the
response says so rather than offering a formula: multiplying by the bank count is only
right for a buffer interleaved across every bank, and most are not — on a local resnet50
capture the operation holding the L1 peak uses 56 of 64 banks, so multiplying overstates
it by 14%, and 16-bank operations in the same report by 4x. How many banks a buffer
actually occupies lives in page-level data that no tool exposes. The report carries no
DRAM capacity at all, which is likewise stated rather than left as a gap.

A tensor's `size` is a whole-tensor byte count — *where the report carries that column*.
Where it does not, which is the common case, the report's own query substitutes the
per-bank allocation figure, and the response labels it `bytes_per_bank` accordingly. So
read `tensor_size_unit` rather than assuming the two figures are in different units.

`memory_profile` groups by operation because the report records what was live *at* each
operation rather than what that operation allocated. A per-operation sum is therefore the
footprint at that point in the run, and the largest of them is that type's peak — which is
the question an out-of-memory failure asks. A peak is a maximum and never a sum across the
run: buffers persist across operations, so adding them would count one allocation once per
operation it stayed live through. Because resident memory barely moves, a peak is usually
shared by many operations, and `operations_at_peak` says how many — the difference between
a single operation you can go and fix and a plateau across the whole run.

**A multi-host report is read one rank at a time.** Operation ids restart at 1 per rank, so
reading every rank at once would collide operations that merely share an id. The database
tools default to rank 0, take a `rank` argument, and name the rank they read in every
response along with a caveat saying the figures describe that rank rather than the job. A
rank the report has no rows for is refused rather than answered empty, since "no
operations at rank 9" otherwise reads as a fact about the run.

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

Page-level memory questions — fragmentation, or the per-bank detail behind the web
application's memory plot — are not exposed. That data runs to millions of rows on an
ordinary capture and needs a different shape than a tool response.

Device profiler logs carry named zones only where a kernel was instrumented to emit them.
Most captures contain only the default firmware and kernel zones — `BRISC-FW`,
`BRISC-KERNEL` and the same pair for `NCRISC` and `TRISC`, plus `ERISC` where a capture
used ethernet cores — so on those reports `zone_timings` describes RISC-level phases rather
than named model operations. A capture whose kernels do emit named zones reports them
alongside the defaults.

The transport is a minimal JSON-RPC implementation rather than the official MCP SDK, which
keeps the server free of additional dependencies while the tool set settles.
