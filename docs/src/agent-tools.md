<!--
SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
-->

# Agent tools (MCP)

TT-NN Visualizer ships a Model Context Protocol server so a coding agent can ask a report
the questions a person asks it during model bring-up: which operations dominate, where the
time went inside them, whether a change helped, and what the run allocated.

It is a read-only surface over the same report readers the web application uses. It starts
no web server, opens no port, and writes nothing to a report. By default it appends usage
events to `~/.ttnn-visualizer/usage/events.log` (tool name and outcome only). Set
`USAGE_RECORDING_DISABLED=true` or create the marker file under that directory to opt out;
see the [event logging](./event-logging.md) reference.

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

The `initialize` response's `serverInfo.version` is the installed ttnn-visualizer
version, so a launcher can check for a minimum release before relying on a tool;
`protocolVersion` is the MCP specification revision, not the package version. A
version of `unknown` means it could not be determined — treat it as unverifiable,
not as old.

The same response carries `instructions`: the rules every tool shares, which a client
puts in the agent's system prompt before any call. They say to call `load_report` first,
that a performance row's `id` and a profiler `operation_id` are different id spaces,
which units the figures are in, how a signpost range is read, what the `projection`,
`note` and `caveat` fields are for, and that text from the report itself, such as an op
code or an error message, is data to read rather than instructions to follow. Each tool's
own description keeps only what is particular to it. `tools/list` gives every tool a `title`, and marks each one read-only,
idempotent and closed-world (`readOnlyHint`, `idempotentHint`, `openWorldHint`), since
none writes anything or reaches past the report it is given. `load_report` reads whatever
directory it is given, though, so a client that approves read-only tools without asking
lets an agent open any report this user can read. Answers are compact JSON.

## Links into the visualizer

Answers link to the same thing in the web application, for the reader to open:

- `load_report` returns an `app_link` to the report.
- `operation_detail` and `operation_provenance` return an `app_link` to the operation.
- `find_operations`, `top_ops`, `program_cache`, `memory_profile`, `tensor_flow`,
  `errors`, `dram_fallbacks`, `l1_peak`, `critical_path` and `subgraph_between` return
  one `app_link_template`, in which
  `{operation_id}` takes any operation id the answer lists.

A link names the report by its directories, and the visualizer opens them when the link is
followed, as `ttnn-visualizer --profiler-path` does: each followed link starts a new session
on that report, so it lands on the report the agent read, not on whatever the reader had
open. The server itself still makes no request; following the link is what opens the
report. A link carries those directories as absolute paths on this machine, so it is for
the reader here, not for sharing.

Links point at `http://localhost:8000` unless the server's environment sets
`TTNN_VISUALIZER_URL`, which may name any host:

```bash
claude mcp add ttnn-visualizer -e TTNN_VISUALIZER_URL=http://localhost:8001 -- ttnn-visualizer-mcp
```

A `TTNN_VISUALIZER_URL` that is not an http(s) URL with a host gives no links at all,
rather than links to the default.

They open only in a visualizer running locally; a hosted one does not open a report by
path, and neither does one framed inside another page. A local one opens a linked directory
without asking, as long as it holds the files a report needs, so follow links you got from
your own agent. A page that plants a `db.sqlite` in a folder you can reach, such as
Downloads, could link the visualizer to it too. An answer read at a rank other than 0
carries no link, because the visualizer shows every operation at rank 0 and would open
another rank's operation under the same id.

## The tools

| Tool | Answers |
|---|---|
| `load_report` | What this report contains, and which of the tools below apply to it: its signposts, architecture, device count and the tt-perf-report version. Returns a handle the others take. |
| `top_ops` | The costliest operations by device time, op-to-op gap, total percentage, FLOPS, DRAM bandwidth or core count, over the whole report or a signpost range. Each row carries the profiler `operation_id` it links to, when the handle holds both reports — see below. `include` adds the fields that say why an operation took its time, and the performance view's heuristic flags. |
| `op_breakdown` | Where the time went, per op or per op category, over the whole report or a signpost range: each group's count, and its device time and op-to-op gap with the share each is of the total. |
| `program_cache` | Whether programs were built again rather than reused: per op code, its calls, distinct programs, and how many repeat calls hit or missed the program cache. |
| `zone_timings` | Per-zone, per-RISC totals from `profile_log_device.csv` — firmware and kernel phases, as measured on device. |
| `core_spread` | How evenly one operation's kernel time fell across the cores that ran it, or the costliest operations': the minimum, median and maximum per-core span and per RISC, the imbalance between them, the slowest cores by coordinate, and how many cores recorded zones against the row's core count. |
| `diff_reports` | Per-operation-code deltas between two reports, largest movement first, over the whole reports or one signpost range in every capture: only moves past a noise threshold count as changes, operations one report lacks are listed apart, and repeated captures of either side are compared by their median. `match: signature` groups by raw op code and tensors instead. |
| `find_operations` | Operations matching a name substring or a call-stack substring, with the ids `operation_detail` takes. |
| `operation_detail` | One operation: its input and output tensors with shape, dtype, layout and memory config, what it had allocated, and the circular buffers each of its device operations allocated, with size per core, core range and device count, with its error and likely DRAM fallback when it has one, and its per-device `l1_pressure` (`fullness_pct`, `free_segments`, `largest_free_block`, `largest_free_pct`). With a linked performance report, also the performance rows it launched, their device time and share of the report's, and the operation's total and slowest row, with the same `include` as `top_ops`. |
| `memory_profile` | Memory footprint per operation, keyed by buffer type and ranked within each, with each type's largest footprint, the device's L1 geometry, and `l1_pressure` ranking operations by smallest `largest_free_block` on the most constrained device. A floor rather than the peak — see below. |
| `tensor_flow` | Which operation produced a tensor and which ones consumed it. |
| `operation_provenance` | What one operation was called with, and where in the model code it came from. |
| `errors` | The errors the run recorded, including an operation that started and never completed: which operation, the device operations whose launch failed, and for an allocation failure its figures and why it did not fit. |
| `dram_fallbacks` | Operations that likely fell back from L1 to DRAM, inferred from their memory config arguments and from retries after an L1 allocation failure. |
| `l1_peak` | The run's L1 peak per bank, split into circular buffers, intra-operation tensors, persistent tensors and stale ones, with the operation holding it and the operations closest to it. |
| `critical_path` | The longest chain of cumulative device time through the operation graph, source to sink, with each operation's device time, the chain's total and share of the report's, and how many of its operations have no device time. Needs a linked performance report. |
| `subgraph_between` | The operations, tensor edges and tensors on every path from one operation to another, each tensor once with its shape, dtype, layout, buffer type and memory layout, so a block can be read without walking it one tensor at a time. |

`top_ops`, `op_breakdown`, `program_cache`, `zone_timings`, `core_spread` and `diff_reports`
read the performance CSVs; the operation tools — `find_operations`, `operation_detail`,
`memory_profile`, `tensor_flow`, `operation_provenance`, `errors`, `dram_fallbacks`,
`l1_peak` and `subgraph_between` — read the profiler report's SQLite database;
`critical_path` reads both, and is listed only when the performance CSV can be reported on
and the database holds the graph's tables and its captured graphs;
`load_report` opens both, since its whole job is saying which of the others apply. A capture can carry either, both, or — as far as these tools are concerned —
neither, which is what makes `load_report`'s answer worth reading first.

Call `load_report` first. It reports what is answerable rather than making you discover it
one failed call at a time, because the report kinds are independent: a performance-only
capture has no operation graph and no tensor data, and a performance tool asked of a handle
loaded without a `performance_path` is refused and says so. `zone_timings` is listed only when
`profile_log_device.csv` decodes as UTF-8, has every column the tool reads (`timer_id`,
`zone name`, `run host ID`, `PCIe slot`, `RISC processor type`, `core_x`, `core_y` and
`time[cycles since reset]`), and has at least one data row. `core_spread` is listed only when
`zone_timings` is, the performance CSV can be reported on, the device log marks zone
starts and ends in a `type` or `zone phase` column, and its first line names a positive
`CHIP_FREQ[MHz]`. `top_ops`, `op_breakdown` and
`program_cache` are listed only when the performance CSV can be reported on, and when it
cannot, `performance_csv_problem` says why (`empty`, `no data rows`, `missing columns: …`, or
that it cannot be read or decoded).
Each database tool is checked against the tables it actually reads, so a truncated
capture that holds `operations` but not `buffers` is reported as answering
`find_operations` and nothing else, rather than advertising every tool and failing most
of them.

`load_report` also says what the capture is:

- `signposts` lists the names a signpost range can take, in the order tt-perf-report
  resolves them, with how often each occurs — one name bounds both ends of a range only if
  it occurs twice — and `signpost_count` counts them all, since the list stops at 20. Both
  are absent when the performance CSV cannot be reported on, and empty when it holds no
  signposts. A name longer than 256 characters, which a range cannot take, is counted but
  left out of the list, and `signposts_unlisted_too_long` says how many were. When the CSV
  can be reported on but its signposts cannot be read, `signposts_problem` says why. Loading reads the signposts, so a handle answers from the
  CSV it was loaded on: one rewritten or superseded after that is refused, and
  `load_report` again gives a fresh handle.
- `arch` and `device_count` are keyed by the file each was read from, since a handle's two
  reports can come from different runs. `arch.device_log` is the device profiler log's
  header, which `capture` also returns whole; `arch.cluster_descriptor` is what the `arch`
  mapping in rank 0's `cluster_descriptor.yaml`, beside the profiler database, names — as
  written, since older descriptors spell Wormhole `Wormhole` and newer ones
  `wormhole_b0`, and joined with commas if its chips differ. The profiler database itself
  records no architecture. `device_count.performance_csv` counts the devices the
  performance CSV has rows for, which no other answer shows because rows are merged across
  devices; it is read with the signposts, so it is absent whenever they are.
  `device_count.profiler` counts the profiler database's devices, every rank's.
- `tt_perf_report_version` is the tt-perf-report release the performance answers are
  generated with, which decides fields such as `op_category`.

## What the answers mean

Five properties are deliberate, and worth knowing before you act on a number.

**Every tool returns an aggregate or a bounded slice, never the table.** A performance
report runs to tens of thousands of rows of about thirty-five fields. Limits are capped
server-side, so asking for more returns the cap rather than the report.

**No rows are hidden from you.** The web application's performance view hides host
operations by default and can narrow to a signpost range. Those are display choices, and an
agent handed them unannounced would reason confidently about a partial set. The tools read
the report with host operations included, signpost markers kept, and, unless you pass one,
no signpost range.

A range is read only when you ask for one. `top_ops`, `op_breakdown` and `diff_reports`
take `start_signpost` and `end_signpost`, the bounds `tt-perf-report --start-signpost` and
`--end-signpost` take, so a bring-up run measured over `PERF_DECODE` to `PERF_DECODE_END`
can be checked against the same window. They are resolved the way tt-perf-report resolves
them: a name means its earliest occurrence by host start time, and an end that names the
start signpost too means its second occurrence. The window holds the rows strictly between
the two, so the bounding signposts are left out and any signposts inside it are kept.
tt-perf-report recomputes `total_percent` over the window, and the first operation in the
window has no op-to-op gap, because tt-perf-report measures a gap from the previous
operation and none precedes it inside the window. Ranking by `op_to_op_gap` therefore
leaves that operation out, and `op_to_op_gap_total` excludes the gap leading into the
window, which is often the largest in the capture. A ranged answer is not the whole-report
answer cut down — it is what the signposted run reports.

A range the report cannot honour is refused rather than answered from other rows: a name
the report does not hold (the refusal lists the names it does), one name for both bounds
when it occurs only once, an end that falls before the start, or a name longer than 256
characters. A report with no signposts at all is read whole, because tt-perf-report then
uses the whole file rather than some other window, and the response's `projection` says so
with `signpost_range_ignored`. Every ranged response's `projection` names the range, so a
windowed answer cannot be taken for a whole-report one. `diff_reports` applies one range to
every capture it compares, and refuses when only some of them hold signposts: a window
compared against a whole report would show every row outside the window as a change. It
checks the range against every capture before generating any, and a refusal names the
report it is about.

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
capture the operation holding the largest L1 footprint uses 56 of 64 banks, so multiplying overstates
it by 14%, and 16-bank operations in the same report by 4x. How many banks a buffer
actually occupies lives in page-level data that no tool exposes. The report carries no
DRAM capacity at all, which is likewise stated rather than left as a gap.

What `operation_detail` does give you is each tensor's `memory_config`, whose
`memory_layout` says whether a tensor is interleaved or sharded, and whose `shard_spec`
carries the grid and shape when it is — so you can tell *why* a per-bank figure does not
scale by the device's bank count, rather than only being told that it doesn't.

A tensor's `size` is a whole-tensor byte count — *where the report carries that column*.
Where it does not, which is the common case, the report's own query substitutes the
per-bank allocation figure, and the response labels it `bytes_per_bank` accordingly. So
read `tensor_size_unit` rather than assuming the two figures are in different units.

**`operation_detail`'s `circular_buffers` are bytes on each core, read from the captured
graph.** An L1 bank is one core's L1, so their `size_unit` is `bytes_per_bank`, the unit
`l1_peak` sums circular buffers in and the unit of the L1 figures under `allocations`. `allocations`
cannot show circular buffers, though: it reads the post-operation `buffers` table, which a
circular buffer never enters. Each entry under `circular_buffers` is one device operation
that allocated circular buffers, as the app's per-core view lists them, and each row gives
a buffer's address, its size on each core, its `core_range_set` and how many distinct
cores that covers. A `core_range_set` past 200 characters is cut, and
`core_range_set_full_length` gives its length; `core_count` still counts all of it. A mesh records every circular buffer once per device; those copies are
one row, and `device_count` says how many devices allocated it. Older mesh captures give
each device its own device operation, which the app lists once per device; here those are
one entry with its own `device_count`, so `circular_buffer_count` counts buffers rather than
device copies. A device operation launched twice on the same device stays two entries. A
`globally_allocated` buffer is a view onto an L1 tensor that is already counted, so it adds
no L1. `max_bytes_per_core` is the largest circular-buffer total on any one core, and a
buffer whose core range is empty is counted in `unattributed_bytes` instead. At most 100
rows are listed, or 25 when `include` is set, as for `perf_rows`; the counts cover them all.

**A captured graph records a program's circular buffers only at its first launch.** A
relaunch from the program cache frees circular buffers and allocates none in the graph, so
on a warm capture most device operations show none. Those launches are counted, not
dropped: `unrecorded_launch_count` says how many, `unrecorded_device_operations` names them
with each name's launch and device counts, and `caveat` says their buffers are unknown
rather than zero. A device operation with no circular buffers at all looks the same in the
graph, so these are most likely, not certainly, cached relaunches.

**A capture written before tt-metal #53041 leaves a failed launch's scope open.** Its
circular buffers are still listed under that device operation, as the app's view lists
them: the graph is read in the view's order, which moves each launch's free-all after its
buffers. That order keeps one snapshot per device operation, so two shapes still leave
buffers out of the listing: a graph cut off right after a launch's buffers, with no free-all
to follow, and a launch whose buffers another node splits into two runs, where the second
run's snapshot replaces the first, as it does in the app. Those are counted in
`unlisted_circular_buffer_count` rather than listed, once per device section on an older
mesh capture, and `caveat` says `circular_buffer_count` and `device_operation_count` leave
them out. For an operation with an error, the failed launch is named in
`error.failed_device_operations`.

The field is absent when the report has no captured graph for the operation, and withheld
when its graph cannot be read for the rank asked for, is past the size a tool will read, or
does not parse; `caveat` then says which. For an operation with an error, the same graph
names `error.failed_device_operations`, which is withheld alike while the rest of the error
still answers. A graph that launched no device operation, with no
`unrecorded_launch_count` and no `unlisted_circular_buffer_count`, is a real zero.

**`memory_profile` reports a floor, not the peak.** It reads the `buffers` table, which
records tensor allocations only. A circular buffer never appears there, and neither does a
tensor allocated and freed inside a single operation. Across the local captures circular
buffers are 52–100% of the real L1 peak wherever a peak has any, and intra-op tensors a
further 24–38%; on `resnet50_may08_1841` the tool reports 487,424 — a figure eighteen
operations share — where replaying the captured graph gives 1,159,840 at operation 29,
2.4x out and not the same operations. Two of the local reports hold almost no L1 tensors at
all, so the tool reports a figure near zero for a model that is saturating L1. Neither the
true peak nor the operation holding it can be derived from it: for an out-of-memory
question, read `errors` and `l1_peak`.

`memory_profile` groups by operation because the report records what was live *at* each
operation rather than what that operation allocated. A per-operation sum is therefore the
footprint at that point in the run, and the largest of them is that type's largest
footprint. It is a maximum and never a sum across the
run: buffers persist across operations, so adding them would count one allocation once per
operation it stayed live through. Because resident memory barely moves, that figure is
usually shared by many operations, and `operations_at_peak` says how many — the difference between
a single operation you can go and fix and a plateau across the whole run.

**A multi-host report is read one rank at a time**, and refuses rather than guess. Operation ids restart at 1 per rank, so
reading every rank at once would collide operations that merely share an id. The database
tools default to rank 0, take a `rank` argument, and name the rank they read in every
response along with a caveat saying the figures describe that rank rather than the job. A
rank the report has no rows for is refused rather than answered empty, since "no
operations at rank 9" otherwise reads as a fact about the run. And where a report carries
`rank` on its operations but not on the table holding the figures — a schema mix that
would silently union every rank and attribute the total to whichever rank you asked for —
the call is refused instead, because a caveat naming a rank the numbers do not describe is
worse than no answer. Where that table feeds only an optional field, the field is withheld
instead, with a `caveat` saying why, and the rest answers: `operation_detail`'s error,
circular buffers and DRAM fallback, and, for `devices`, `l1_pressure` and
`memory_profile`'s `device` block, which are null.

**A total on a partitioned run carries a caveat.** When a report spans more than one
sub-device, operations on different sub-devices can run concurrently, so summed device
time, total percentages and op-to-op gaps overstate elapsed time. Responses that include a
total say so, and name the sub-devices involved — `top_ops`, `op_breakdown` and
`diff_reports` alike, since a share or a delta of an unsound total is unsound the same way,
and `operation_detail` wherever it returns `report_device_time_total`, since its shares
divide by that total.

Totals are only reported for metrics a sum means something for: device time, op-to-op gap
and total percentage. DRAM bandwidth, FLOPS and core count are per-operation figures, and
adding them across a report would produce a number that looks authoritative and is not.

A null `bound` does not mean an operation is fine. Every row from `top_ops` and every
`perf_rows` entry from `operation_detail` carries `bound_analysis`, which says which roofline
model tt-perf-report ran: `full` (matmuls) derives DRAM, FLOPs and the bound, or leaves the
bound null when the trace lacked the inputs the model needs; `flops_only` (convolutions)
derives FLOPs alone, so DRAM and the bound are never set; `none` (everything else) derives
nothing, so a blank there says nothing about whether the operation is a bottleneck. A `SLOW`
bound means the full model ran and neither DRAM nor FLOPs reached 65% of peak. Rows also carry
`op_category`, which tt-perf-report 1.4.0 sets to `Compute`, `CCL`, `DM`, `TM`, `Host` or
`Other` and leaves null on signposts. The list can grow in later releases (`CCL` was added
recently), so treat an unfamiliar value as a category, not an error. `Other` is time no
category explains.

**`include` adds the fields that say why an operation took its time.** A `top_ops` row and
an `operation_detail` `perf_rows` entry name the operation and its metric unless asked for
more. Asked for more, rows are capped at 25 rather than 100: with every group a row runs to
about 3 KB, and 100 of them would pass a client's limit on one tool answer. `include` takes
any of these groups:

- `config`: math fidelity (LoFi, HiFi2, HiFi3 or HiFi4, from the CSV's `MATH FIDELITY`, and
  null for an operation without one), input and output datatypes, input 0's memory, DRAM
  sharding, and the matmul block sizes. How the operation was set up.
- `utilisation`: DRAM bandwidth and FLOPs, each also as a percentage of peak, and the perf
  model's ideal, compute and bandwidth times and FPU utilisation. How close the operation
  came to what the hardware can do; DRAM and FLOPs follow `bound_analysis` above.
- `noc`: NoC, multicast NoC, DRAM and Ethernet bandwidth utilisation, and the NPE
  congestion impact.
- `riscs`: kernel time per RISC, and how long the compute kernel waited at the front and
  back of its circular buffers. Which stage limits the operation: the readers and writers
  on BRISC and NCRISC, or unpack, math and pack on the three TRISCs.
- `cores`: available cores, the time from the first core's kernel start to the last's,
  and the per-core minimum, maximum and average kernel time. Launch skew and imbalance.
- `dispatch`: the op-to-op gap, dispatch's command and GO-send wait times, and the metal
  trace ids. Why the gap before an operation is large.
- `cache`: the program hash, whether the program cache held it, and the global call count.
- `kernels`: the compute and data-movement kernel sources and their hashes, as lists.
- `advice`: tt-perf-report's advice for the operation, which today covers matmuls.
- `flags`: the performance view's heuristic flags for the operation — `dram_bound`,
  `low_utilisation`, `underutilised_cores` and `recompute_candidate` — each with the figures
  it fired on. See below. It adds no CSV columns, so `include: ["flags"]` alone brings no
  `included`, `empty_in_report` or `detail_note`.

Times in these groups are microseconds, like `device_time`, although the CSV records most
of them in nanoseconds. They come from the same merged row as the rest of it: for an
operation that ran on several devices, the slowest device's row, except for an
all-gather, reduce-scatter or all-reduce, where tt-perf-report averages the device time
and keeps the first device's row for everything else, so `kernel_us` there is one
device's time rather than the average. The web application's rows carry the fields
tt-perf-report generates; the ones read straight from the CSV — the math fidelity, the
per-core spread and launch skew, the circular-buffer waits, the dispatch waits, the
kernels, the perf model's compute and bandwidth times and FPU utilisation, and the `noc`
group — reach only these tools.

tt-metal's performance model leaves its ideal times at 1 ns for an operation it does not
model, so a 1 ns ideal time reads as null rather than as a measured one, and so does an
FPU utilisation derived from it. Read against the operation's real duration, that
placeholder would claim a million-fold gap.

Many of these fields are empty unless the capture asked for them. A field that no row of
the whole report carries, whatever range was read, is left out of the rows and named in
`empty_in_report` instead, with what would fill it: `--collect-noc-traces` for the `noc`
group, `--profile-dispatch-cores` for the dispatch wait times, a captured metal trace for
the trace ids, and a performance model that computes them for the ideal times. A field
whose column the report does not have at all is named as such, since no capture option
fills it on the tt-metal that wrote the report. A field empty on some rows only is usually
one those operations do not have, such as a block size on an operation that is not a
matmul; the `noc` fields are filled only for the operations tt-metal matched to its NoC
traces.

**`flags` are the performance view's heuristic flags, with their evidence.** Asked for
them, every row carries `flags`, a list in the order the performance view shows them and
empty when none applies, and the `total_percent` that gates the first three of them. The
answer's `flag_basis` says what they were read against. Each entry names its `flag` and
the figures behind it, in place of the view's display text, and repeats no field the row
already carries:

- `dram_bound`: DRAM bandwidth is the likely bottleneck. `reason` is `bound_dram` when
  tt-perf-report's `bound` is `DRAM`, or `slow_dram_above_flops` when it is `SLOW` and DRAM
  is a larger percentage of its peak than FLOPs are; `dram_percent` and `flops_percent` are
  the two percentages.
- `low_utilisation`: `core_utilisation_percent` is below 30%, cut rather than rounded to
  three places so a figure under the threshold never reads as at it. It is the perf model's
  ideal time over the device time, scaled by the cores the operation could have used over
  the cores it did. `roofline_modelled` is false when tt-perf-report has no roofline model
  for the operation (`bound_analysis` `none`), so the ideal time it is compared against is
  less reliable, and null when the report does not say.
- `underutilised_cores`: the row's `cores` are fewer than a quarter of `core_capacity`,
  which is the row's own available cores (`core_capacity_from` `available_cores`) or, for a
  row without them, the device's (`max_cores`).
- `recompute_candidate`: a repeat call of a program that missed the program cache — a
  repeat miss, as `program_cache` counts one, though `program_cache` also counts the ones on
  rows no flag applies to, below. The `cache` group's `program_hash` names the program.

The first three apply only to an operation whose `total_percent` is at least 0.5, so they
move with a signpost range, over which tt-perf-report recomputes `total_percent`, as the
view's move with its signpost filter. None applies to a signpost or a host operation.
Whether a row is its program's first call is decided over the whole report, as
`program_cache` decides it, even when a range is read: the view decides it over the rows it
shows, so there a program first called before the window reads as first called inside it.

`flag_basis.flagged_rows` counts each flag over every row the answer read — the whole
report or the signpost range for `top_ops`, every row of the operation for
`operation_detail` — so a flag on a row past the cap is not missed. When every repeat call
in the report that recorded a cache result missed, `flag_basis.caveat` carries the caveat
`program_cache` gives: that is what a run with the program cache disabled records, so
check whether it was before reading each recompute candidate as a program built again.
`flag_basis.note` repeats the two ways the flags read the report differently from the
view, below.

`flag_basis.max_cores` is the device's core count, read where the web application reads it,
through the same reader as `/api/performance/device-log/meta`: `Max Compute Cores` on the
device log's first line (`max_cores_source` `device_log`); else the default for the device
log's `architecture`, or Wormhole's when there is no device log or it names no architecture
the application knows (`architecture_default`); or, where it is more, the most cores any row
of the report used (`report_rows`). A count of 0 falls back to Wormhole's
(`fallback_default`). The rows that fallback reads are the whole report's even for a ranged
read, since a window does not change the device, where the view reads the rows it shows.

The flags read the report differently from the view in two deliberate ways. Over a
signpost range, first calls and the `report_rows` fallback read the whole report, as above.
And the view reads tt-metal's 1 ns ideal-time placeholder, described above, as a modelled
time, which against an operation's real duration gives a utilisation near zero, so it flags
low utilisation on operations the model never modelled
([#2162](https://github.com/tenstorrent/ttnn-visualizer/issues/2162)): across ten local and
demo captures, 166 of its 239 low-utilisation flags. Here a 1 ns ideal time never flags
`low_utilisation`. Every other flag those captures carry unranged is the view's.

The view's other two flags are not in the list, because other tools answer them in more
detail: an allocation failure is `errors`' (and `operation_detail`'s `error`), and a likely
DRAM fallback is `dram_fallbacks`' (and `operation_detail`'s `dram_fallback`). Recompute
candidates are also counted per op code by `program_cache`.

**`program_cache` says whether programs were built again.** A row is its program's first
call when no earlier row in the report carries its program hash, and a repeat call
otherwise, which is how the performance view counts its cache-hit percentage. A first call
builds its program, so it misses the cache by design. A repeat call should hit it: a repeat
miss built a program the run had already built, and the performance view flags it as a
recompute candidate. The answer counts calls, distinct programs, repeat calls, and repeat
hits and misses, with the most repeat misses first, per raw op code: one entry holds every
shape of a matmul, where tt-perf-report's `op_code` would split it by shape. It reads the
whole report and takes no signpost range, because a program first called before a window
would read as a first call inside it. A repeat call that recorded no cache result is
neither a hit nor a miss: `repeat_unrecorded` counts them, the hit percentage is out of the
rest, and a caveat says so. When every repeat call that recorded a result missed, the
answer says that is what a run with the program cache disabled records, so check before
reading each miss as a program built again. A capture without the `PROGRAM HASH` and `PROGRAM CACHE HIT`
columns cannot answer, and `load_report` says so. Each op code's first repeat miss is
named by its CSV row in `first_repeat_miss_perf_id`, and when the handle also holds a
profiler report, by `first_repeat_miss_operation_id` too, for `operation_provenance` to
turn into a call site.

**`op_breakdown` says where the time went, grouped as the performance view's stacked table
groups it**, which is tt-perf-report's stacked report. `group_by: op`, the default, takes the
op code's first word, as `tt-perf-report --group-by op` does, so every shape of a matmul is
one entry and every host op falls under `(torch)`; `group_by: op_category` groups by
category. The table's third grouping, by input 0's memory, is not offered. Signposts are
left out, and a host op counts with no device time; the application's stacked table hides
host ops by default, so its default view has no `(torch)` row. Each group carries its count,
its summed device time and op-to-op gap with each one's share of the total — to three
significant figures, as `operation_detail`'s shares are, so a sliver reads as one — and
`total_percent`, tt-perf-report's Total % summed: the share of device time and op-to-op gap
together. A row's op-to-op gap is the time before it, so a group's gap is the dispatch time
spent waiting to launch its operations. Groups are ordered by `by`, device time unless asked
otherwise, and those past the limit are summed into `rest`, so the shares returned still add
up to the whole. Over a range, the shares are of the window, whose first operation has no
op-to-op gap. On every local performance capture, the groups, their counts, their device
time and their shares match the stacked report tt-perf-report generates from the same CSV.
That report itself is not generated: the answer is computed from the rows, which also gives
it the op-to-op gap the stacked report leaves out.

**`diff_reports` calls a move a change only when it is bigger than run-to-run noise.** Two
captures of the same code never time an operation identically, so a diff that ranks every
group that moved puts that jitter beside real changes. On two captures of one model taken
minutes apart, every op code's device time moved, by up to 3.8%, and on another such pair
by up to 4.3%. A group therefore counts as a change only when it moved by at least
`min_percent` of its baseline figure, 5% unless asked, and by at least `min_delta` in the
metric's unit: 1 µs for device time and op-to-op gap, 0.1 percentage points for
`total_percent`. The floor keeps a small operation's jitter from counting, since a percentage
of a tiny figure is mostly jitter: on the second pair a 3.5 µs operation moved 4.3%, by
0.15 µs. Requiring both is the rule tt-metal's LLK performance regression check applies.
Both are judged on the figures as the answer gives them, so a move of exactly `min_percent`
counts.
`thresholds` names the values used, with `min_delta_unit` the unit `min_delta` is in, `changes` lists the changes largest first with
`delta_percent` beside each `delta`, `change_count` counts them all, `returned` counts
those listed, and `within_threshold_count` counts the groups both reports hold that moved
less. `limit` caps `changes` at 100, and `new`, `missing`, `unmeasured` and `inconsistent`
return as many, up to 25 each; each list's count says how many more there are. Every list breaks a tie by the group's name, so a list cut at its
limit is the same each time it is asked. A move from
zero has no percentage, so only `min_delta` applies to it. Lower thresholds show smaller
moves, and 0 for both lists every group that moved at all.

An operation only one report ran is neither faster nor slower, so it is never a change:
`new` lists the groups only the second report ran, with their figures there, and `missing`
those only the first ran, each largest first and counted in full by `new_count` and
`missing_count`. Which groups a report ran is read from every row, figure or not:
tt-perf-report leaves a call's figure blank where its duration is invalid, as it does a
report's first op-to-op gap. A group both reports ran with no figure at all on one side is
listed under `unmeasured`, with its calls and how many of them carry a figure on each side,
and a caveat says each side's total covers only the calls with one; a group with no figure
in either report, such as a host operation's device time, is left out. A change over fewer
measured calls on one side than calls carries `measured_before` and `measured_after`, since
its total covers only those, and a `new` or `missing` entry over fewer carries
`measured_after` or `measured_before` for the same reason, 0 where a capture left every
call blank and the figure is null.

`repeats_a` and `repeats_b` take further captures of either side, run the same way, up to
5 captures a side, and the answer names them under `repeats_before` and `repeats_after`. Each figure is then the median of the side's captures, as the LLK
check compares repeated runs, which makes a lower threshold safe to read; with two captures
a side the median is their mean, so three or five resist one outlier. An entry's measured
calls are the fewest among the captures its median comes from, so a partial capture's sum
never reads as complete, and `new` and `missing` rank by the median each entry gives rather
than by one capture's total. A group the side's captures disagree on, by whether it ran or
how many calls it made, is listed under
`inconsistent`, largest first, with `calls_before` and `calls_after` giving each capture's
calls, rather than compared on unlike work. Each capture may be given once: a handle given
twice, or two handles loaded on the same capture, is refused. A capture's totals are kept
per range, by op code and, once a signature diff asks, by signature, so asking again with
other thresholds, another metric or a match already asked generates no report; a whole
report's totals stay for the server's life, and a range's for up to 64 captures and ranges,
the least recently used dropped first. Signatures are a second read of the CSV, so an op
code diff skips them, except for a repeat, whose report is dropped once read. Totals read
from a report generated with errors tt-perf-report skipped, which may be missing rows by
chance, are not kept, so the next call reads that report again, and a caveat names the
capture, since a group it lost reads as new or missing. The first call generates each
capture's report that no tool has read yet, which on a single-device capture of 100,000
rows takes about 20 s, so its time grows with repeats.
The two compared captures' reports then stay loaded, as every handle's does, about 350 MB
at that size, while a repeat's is read for its totals and dropped.

Without `match`, a group is tt-perf-report's op code, which already names a matmul's shapes
and a convolution's or halo's configuration. `match: signature` groups instead by the raw op
code and its input and output tensors' shapes, layouts, dtypes and memory, read from the
CSV's `INPUT_n_*` and `OUTPUT_n_*` columns, and names each group by `raw_op_code` and
`signature`. That splits an operation whose op code names no shape, such as
`InterleavedToShardedDeviceOperation`, and pairs a convolution whose configuration changed as
one change rather than a `new` and a `missing`, while summing two configurations of one
convolution over the same tensors. The device a memory name carries
(`DEV_1_L1_INTERLEAVED`) is left out, so the copies of one operation across a mesh's devices
match. Calls are summed per signature, not paired by occurrence (#2228), so one slow layer
among many identical ones moves its signature by its share. A signature holds fewer calls than an
op code, so it moves more between runs of the same code: on the first pair above, three
two-call shapes of one op code moved by 9–18% while the op code as a whole moved 2.9%, and
the answer's caveat quotes that before a signature's move is read as a change. A signature
past 300 characters is cut, `signature_full_length` gives its length, and `signature_digest`
a digest of the whole signature, so two signatures cut alike are told apart. An op code past
it is cut the same way, with `op_code_full_length` and `op_code_digest`
(`raw_op_code_full_length` and `raw_op_code_digest` with signatures). With signatures
`changes` is capped at 25 rather than 100. A capture whose CSV has no tensor columns, or
cannot be read, is refused. Older captures record a tile-padded size alone, where newer
ones record `padded[logical]`, so an operation on a padded tensor has a different signature
in each; `mismatched` names `tensor_sizes` when the captures differ in it, as `padded` or
`padded[logical]` by handle.

When the captures' device logs name different architectures, clocks or compute core
counts, or their CSVs hold rows for different numbers of devices, `mismatched` lists the
values by handle and a caveat names the facts, saying every delta measures that difference
too. They are read once per capture, as its rows are, and the device log is read as the
`flags` group reads its cores, so the two cannot disagree about a device. The diff is still
answered, since comparing two architectures can be the question. A fact not every capture
records, as when one has no device log, is listed under `unverified` with the handles that
record none, and a caveat says whether they match there is unknown. A fact no capture
records is listed with every handle, since unknown on every side is not equal. Every capture is generated by the same tt-perf-report, the release
`load_report` names.

Two metrics carry a caveat of their own. Op-to-op gaps are host time between operations,
including dispatch and a program's compilation on its first call: on the first pair above
they moved by a median of 17% per op code, so 38 of its 55 op codes count as changed by
op-to-op gap and none by device time. `total_percent` is a group's share of its report's
device time and op-to-op gap together, so it carries the gaps' noise, 48 of 55 on the same
pair, and moves whenever any other group does: on two resnet50 captures three weeks apart,
four matmuls' shares more than doubled while their device time moved by under 1%. Compare
device time to see whether a kernel changed.

`delta_total` and `delta_total_percent` compare the reports' totals, the medians of the
captures' totals with repeats, beside `<metric>_total_before` and `<metric>_total_after`.

**`errors` says where a run stopped and why an allocation failed.** It lists the rows of the
report's `errors` table, as the web application shows them. An `incomplete_operation` error
is an operation that started and never completed, so the run most likely crashed inside it.
An error the report could not place on an operation of that id and name has `attached`
false; the application shows those at report level. `failed_device_operations` names the
device operations in the operation's captured graph whose launch did not complete, up to 20,
and `failed_device_operation_count` counts them all. When the message is one of tt-metal's
four allocation failures — out of memory, out of memory after considering dependencies,
circular buffers beyond L1, circular buffers clashing with an L1 buffer —
`allocation_failure` carries its figures and `diagnosis` says why it did not fit, with the
reasons [Allocation failures](allocation-failures.md) describes. Only a message's first
32,768 characters are read for one, several times the longest real message, and its
`core_range` is cut like a message. `requested_bytes` is the whole request across
`num_banks`; the other bank figures are per bank. An unattached error's `operation_id` can
name an unrelated operation, so it is not one to open with `app_link_template`. A report
that predates the `errors` table says so in its caveat rather than reporting no errors.

**`dram_fallbacks` is inferred.** tt-metal records nothing when an operation falls back
from L1 to DRAM. An operation counts when its memory config arguments all ask for L1 while
every output it allocated itself is in DRAM, or when it runs within three operations of a
same-named one that failed to allocate L1 and its outputs are in DRAM. An output that may
be a view of a DRAM input is left out. `operation_detail` carries the same `dram_fallback`
for its operation.

**`l1_peak` is the figure for an out-of-memory question.** It replays every operation's
captured graph against the post-operation `buffers` snapshot, so it counts what
`memory_profile` cannot: circular buffers and tensors allocated and freed inside an
operation. The peak is in bytes per bank, split into circular buffers, intermediate,
persistent and stale tensors. Stale tensors are still allocated after their last real
consumer, the only part freeing earlier would help. `top_operations` keeps one entry per
distinct composition, with `also_at` naming the operations that repeat it, since a model
that runs one layer stack several times reaches the same figure at each. `also_at` names at
most 20 of them, and `also_at_count` counts them all: one local capture repeats a
composition 9,679 times. `precision` is `upper-bound` wherever more than one resident is
summed, since a capture does not say which cores each occupies. When the replay exceeds the
device's L1 its figures are withheld and `reason` says why, as the web application's L1 peak
panel does. The first call on a handle reads every captured graph, which can take seconds on
a large capture; later calls reuse it.

`zone_timings` carries a caveat of its own: cycles are summed across every core that ran
the zone, so they measure occupancy rather than wall-clock duration. A core is counted per
device — the captures we test against span 8 and 32 PCIe slots, and coordinates alone
repeat on each — so a zone can report thousands of cores on a multi-device run. Durations
need the device log's `type` column to pair zone starts with ends; a capture without it
reports occurrence counts only, and a capture that stopped mid-zone reports how many starts
and ends failed to pair so a partial total does not read as a complete one.

`core_spread` reads each operation on one device only, never pooling devices, since each
runs its own clock. A performance row's global call count is the device log's `run host ID`
and its device is the log's `PCIe slot`. That pair does not single out one execution: a
traced operation's replays share it, and call counts repeat from one capture to the next.
So a row's zones are only those inside its own `DEVICE FW START CYCLE` to
`DEVICE FW END CYCLE`, which keeps each replay's figures its own. An operation with zones
under its call count and device but none inside its firmware cycles has `in_log` false.
When no row of that call count and device has zones inside its own cycles, the caveat says
the log belongs to another execution — usually a device log beside a different run's
performance CSV. When other replays do, it names a profiler buffer that filled partway
through the trace as the likelier cause, since that drops later replays' zones. A row without firmware cycles takes every zone of its call
count and device, and when other rows share them its figures pool theirs, which a caveat
says. On a multi-device report a row is the slowest device's, except an all-gather,
reduce-scatter or all-reduce, where it is the first device's but its `device_time` is the
mean across devices, so its core spans need not match it; each operation names its
`device`. A core's span runs from its first kernel start to its last kernel end across its
RISCs, which is how tt-metal measures `DEVICE KERNEL DURATION PER CORE`, and the
performance CSV's own minimum, maximum and average are returned beside it where the capture
has them. `imbalance` is the maximum over the median. `slowest_cores` name cores by the
device log's NOC coordinates, not logical worker coordinates: Wormhole's worker (0,0)
logs as (1,1). An operation with no kernel zones for its call count and device has
`in_log` false and no figures rather than zeros: the log can cover different runs from the
CSV, or stop before them. When fewer cores recorded zones than the row reports, the spread
covers only the cores that did. Dropped markers cause that, and tt-metal reports a full
profiler buffer in its host log only, never in the device log. When more cores recorded
zones than the row reports, as a DRAM-sharded matmul's helper cores do, the median and
`imbalance` mix cores with different roles, while the maximum and `slowest_cores` still
name the cores that set the time; a caveat says so. Unpaired zones are counted per call
count and device, not per replay, so an unpaired zone in one replay is reported on every
replay of that operation. A kernel row whose slot, core or cycle count is not a number is
left out and counted in a caveat rather than failing the call. The first call on a handle
reads the whole device log once for every operation in the report, and later calls answer
from that read, with the clock it was read at.

**A performance row and a profiler operation are linked by order, not by a shared id.**
Neither report records the other's id, so when a handle is loaded with both, the tools
align the device operations each profiler operation launched (from its captured graph)
against the performance rows, in order — the same match the application uses to link a
memory report to a performance report. `top_ops` then gives each row an `operation_id`,
and `operation_detail` lists an operation's `perf_rows` with device time in microseconds;
its own `duration` is host seconds. Each row's `device_time_share_percent` is its percent
of `report_device_time_total`, the device time of every row that is not a host op or a
signpost, whether or not it linked to an operation. That is not tt-perf-report's
`total_percent`, which also counts the op-to-op gap, so on an untraced capture it mostly
measures dispatch gaps rather than device time. Nor is `report_device_time_total` quite
`top_ops`'s `device_time_total`, which sums every row's device time; the two agree on
reports tt-perf-report writes, since it leaves host ops and signposts without one. At the
top level, `device_time`, `device_time_share_percent` and `slowest_perf_id` cover all of
the operation's rows, including any past the cap on `perf_rows`, so the slowest row may be
one `perf_rows` does not list. A row whose device time tt-perf-report left blank has a
null share and is left out of the total; when no row has a device time, those three keys
are absent.

A device operation whose launch threw — an allocation failure, for one — never reached the
device and has no performance row, so the match leaves it out. Left in, it would put a name in
the order that no row answers, and a report with a failure would usually not link at all. Newer captures mark its scope `aborted`; older ones leave it
unclosed. The operation keeps any earlier device operations that did run.

Every response that carries the link says how it went in `operation_link`:

- `linked` names the rank the ids belong to — the CSV records no rank, and rank 0 is what
  the application links against — and `matched_rows` says how many rows linked.
  `operation_detail` read at any other rank reports `unavailable` and lists no
  `perf_rows`, because ids restart per rank.
- `unlinked` means the two sequences do not line up — usually two different runs, or a
  performance capture that stopped early — and every `operation_id` is then null rather
  than guessed.
- `unavailable` means the match was never tried: one half is missing or cannot be read,
  the profiler report records no captured graph, one of its captured graphs is not
  readable, or a multi-host report carries no `rank` on the graph or device tables. A link that skipped an unreadable graph could still align and pair rows
  with the wrong operations, so none is attempted.

On a linked pair an `operation_id` is still null for a row with no profiler operation:
a host op, a signpost, or a row past the end of a profiler capture that stopped before
the performance one did. The match tolerates trailing rows, as the application's does.
`top_ops` counts such rows in `operation_link.unlinked_by_reason` — `signpost`,
`host_op` and `past_profiler_capture` — totals them in `unlinked_row_count`, and names
the first row past the profiler capture in `first_past_profiler_capture_id`. Read the
counts there rather than counting null ids among the ranked rows: the ranking leaves out
any row with no value for its metric, which is every signpost, so `matched_rows` and the
rows returned do not add up to the report.

A signpost range narrows the ranked rows and nothing else. The link is matched against the
whole report, since alignment is by order and a window would start it mid-run; a row's id is
its CSV position in either read, so its `operation_id` is the one it has unranged. Its
`operation_link` then carries `scope: whole_report`, because every count in it, and
`operation_detail`'s `report_device_time_total` and shares, describe the whole report while
`top_ops`'s own `op_count` and totals describe the window.

The link is resolved once per handle, on the first `top_ops`, `program_cache`,
`operation_detail` or `critical_path` that needs it, and reads every captured graph at the linked rank. On a handle with both reports,
the first `operation_detail` therefore also generates the performance report, which can
take seconds on a large capture; every later call reuses both. A link that failed on a read
that might pass next time — a locked database, a temp-file error in tt-perf-report — is not
kept, so the next call tries again. A handle keeps answering from the capture it first
read, so it never mixes two. A read that needs the CSV again after it was rewritten, or
after a newer `ops_perf_results` file appeared — a range not asked before, or one dropped
from the cache — is refused rather than lined up against operations linked from the old
capture; call `load_report` again for a fresh handle.

**`critical_path` and `subgraph_between` read the graph's edges as the graph view does.**
An edge runs from the operation that produced a tensor to each operation that consumed it,
one per tensor. `critical_path` then leaves out deallocate operations and operations with
no edge at all, as the graph view does by default, and finds the chain whose operations'
device time adds up to the most — the same search the graph view's critical path runs,
held to it by a shared golden. Ties go to the longer chain, then to the lower operation id.

An operation weighs the summed device time of every performance row it launched, as
`operation_detail` totals it. The graph view weighs an operation by its slowest row
instead, so on an operation that launches several device operations the two can name
different paths. An operation with no timed row — unlinked, or a row tt-perf-report left
blank — counts as 0 and is still traversed, so a gap in the performance report shortens
the path rather than breaking it: `uncosted_operation_count` and `uncosted_operation_ids`
say how much of the path is a gap rather than a measurement, and the caveat says so
whenever any is. A report whose tensor edges form a cycle gets `has_cycle: true` and a path
over the acyclic portion only. The tool needs the two reports linked, and reads the linked
rank only, since an unlinked graph has no weights and its longest chain is not a critical
path. `device_time_share_percent` is the path's share of `report_device_time_total`, as in
`operation_detail`. `projection` is the performance report's, as every tool that reads it
gives it, and `graph_projection` says which graph the path was searched over.

`subgraph_between` needs only the database, and takes `rank`. It lists the operations
reachable from `from_operation_id` that also reach `to_operation_id`, and the edges between
them, sorted by id; `operation_count` and `edge_count` are the whole subgraph's when a list
is capped. Unlike `critical_path`, it keeps deallocate operations, so one can be either
end of the subgraph or on a path through it. `tensors` lists each tensor on those edges
once, by id, with its shape, dtype, layout, buffer type and memory layout — what reading a
block's layout needs. It is capped lower than the other lists, at the limit
or 25, whichever is smaller, and `tensor_count` counts them all. It leaves out a tensor's
size, whose unit depends on the capture: `operation_detail` and `tensor_flow` give it, with
its `tensor_size_unit`, and the shard spec. When no path runs from the first operation to
the second, the call is refused, and says so when one runs the other way.

Both tools read the graph once per handle and rank, so walking a model block by block
pays for the read on the first call only.

**An operation id is not the end of the answer.** `memory_profile` names the operations
holding its largest footprint, and `operation_provenance` turns such an id into the two things you need
to act on it: the arguments it was called with, and the innermost stack frame's file,
line, function and source line.

`top_ops` names an operation too, but its `id` is a row of the performance CSV and does
not belong here (`diff_reports` returns no id at all: it groups by op code, or op code and signature): the two ids are small integers in overlapping
ranges, so passing one where the other belongs answers about a different operation
rather than refusing. Pass a `top_ops` row's `operation_id` instead, or search for the
name with `find_operations`. `program_cache`'s `first_repeat_miss_perf_id` is a CSV row in the
same way, and `first_repeat_miss_operation_id` is the one to pass. Frames are recorded innermost first, so the call site is the `ttnn.<op>`
call in the model code with no guessing about which frame is yours, and it is the same
frame the operation details panel shows for that operation.

Argument values are capped, with `truncated` and `full_length` set when one was cut, and
`truncated_count` saying how many of them were: truncation is the normal case rather than
the exception — 28% of the argument values across the local captures run past the cap,
and the longest is 177,717 characters, because a tensor repr or a `Conv2dConfig` lands in
one.

Two different absences are reported apart. A capture that records no trace for an
operation says so. A capture that records a trace this parser cannot read — a native C++
backtrace, which 8 of 86 local captures write for every operation — says the call site is
*unknown* rather than absent, because those are different facts and only one of them is
about the operation.

`operation_provenance` takes a `limit` for the outward chain. The call site is reported
separately and never counted in it, so a small number is usually right: a real trace runs
to tens of frames, most of them the test harness that invoked the model.

`find_operations` takes `called_from` for the inverse question, which is the one that
follows: not "what about this operation" but "what about every operation from that
helper". It matches anywhere in the stack, so a layer module finds the operations it
called through helpers rather than only those it called directly.

## Limitations

Accuracy questions are not answerable. Both tensor-comparison tables exist in every
local capture and are empty in every one, so there is nothing to build a PCC tool on.

Page-level memory questions — the per-bank, per-page detail behind the web
application's memory plot — are not exposed, because `buffer_pages` runs to millions of
rows on an ordinary capture and needs a different shape than a tool response. Per-operation
L1 fullness, free-segment counts and the largest free block are derived from `buffers` and
`devices` instead (bounded per device to `[address_at_first_l1_cb_buffer,
address_at_first_l1_cb_buffer + l1_bank_size)`, capped at `worker_l1_size`, and reporting
the most constrained device — the one with the smallest largest free block — with
free-space figures marked as an upper bound because circular buffers and intra-op tensors
are absent) and exposed as `l1_pressure` on `operation_detail` and `memory_profile`. Its
figures are bytes per bank (`size_unit`), so a whole-tensor size in `bytes` is not
comparable to them. It is null, with a caveat saying why, for an operation with no
`buffers` rows, a report whose devices record no L1 geometry, or a report holding more
than one rank whose `devices` table carries no `rank`. A `device_id` with more than one
row is read as its last row, as the web application reads it, for `l1_pressure` and the
`device` block alike, and `device.devices` counts distinct ids.

Device profiler logs carry named zones only where a kernel was instrumented to emit them.
Most captures contain only the default firmware and kernel zones — `BRISC-FW`,
`BRISC-KERNEL` and the same pair for `NCRISC` and `TRISC`, plus `ERISC` where a capture
used ethernet cores — so on those reports `zone_timings` describes RISC-level phases rather
than named model operations. A capture whose kernels do emit named zones reports them
alongside the defaults.

The transport is a minimal JSON-RPC implementation rather than the official MCP SDK, which
keeps the server free of additional dependencies while the tool set settles.
