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

## Links into the visualizer

Answers link to the same thing in the web application, for the reader to open:

- `load_report` returns an `app_link` to the report.
- `operation_detail` and `operation_provenance` return an `app_link` to the operation.
- `find_operations`, `top_ops`, `program_cache`, `memory_profile`, `tensor_flow`,
  `errors`, `dram_fallbacks` and `l1_peak` return one `app_link_template`, in which
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
| `load_report` | What this report contains, and which of the tools below apply to it. Returns a handle the others take. |
| `top_ops` | The costliest operations by device time, op-to-op gap, total percentage, FLOPS, DRAM bandwidth or core count, over the whole report or a signpost range. Each row carries the profiler `operation_id` it links to, when the handle holds both reports — see below. `include` adds the fields that say why an operation took its time. |
| `program_cache` | Whether programs were built again rather than reused: per op code, its calls, distinct programs, and how many repeat calls hit or missed the program cache. |
| `zone_timings` | Per-zone, per-RISC totals from `profile_log_device.csv` — firmware and kernel phases, as measured on device. |
| `diff_reports` | Per-operation-code deltas between two reports, largest movement first, over the whole reports or one signpost range in both. |
| `find_operations` | Operations matching a name substring or a call-stack substring, with the ids `operation_detail` takes. |
| `operation_detail` | One operation: its input and output tensors with shape, dtype, layout and memory config, and what it had allocated, with its error and likely DRAM fallback when it has one. With a linked performance report, also the performance rows it launched, their device time and share of the report's, and the operation's total and slowest row, with the same `include` as `top_ops`. |
| `memory_profile` | Memory footprint per operation, keyed by buffer type and ranked within each, with each type's largest footprint and the device's L1 geometry. A floor rather than the peak — see below. |
| `tensor_flow` | Which operation produced a tensor and which ones consumed it. |
| `operation_provenance` | What one operation was called with, and where in the model code it came from. |
| `errors` | The errors the run recorded, including an operation that started and never completed: which operation, the device operations whose launch failed, and for an allocation failure its figures and why it did not fit. |
| `dram_fallbacks` | Operations that likely fell back from L1 to DRAM, inferred from their memory config arguments and from retries after an L1 allocation failure. |
| `l1_peak` | The run's L1 peak per bank, split into circular buffers, intra-operation tensors, persistent tensors and stale ones, with the operation holding it and the operations closest to it. |

`top_ops`, `program_cache`, `zone_timings` and `diff_reports` read the performance CSVs; the
operation tools — `find_operations`, `operation_detail`, `memory_profile`, `tensor_flow`,
`operation_provenance`, `errors`, `dram_fallbacks` and `l1_peak` — read the profiler
report's SQLite database;
`load_report` opens both, since its whole job is saying which of the others apply. A capture can carry either, both, or — as far as these tools are concerned —
neither, which is what makes `load_report`'s answer worth reading first.

Call `load_report` first. It reports what is answerable rather than making you discover it
one failed call at a time, because the report kinds are independent: a performance-only
capture has no operation graph and no tensor data, and a report with no device profiler log
cannot answer `zone_timings`. `top_ops` and `program_cache` are listed only when the
performance CSV can be reported on, and when it cannot, `performance_csv_problem` says why
(`empty`, `no data rows`, `missing columns: …`, or that it cannot be read or decoded).
Each database tool is checked against the tables it actually reads, so a truncated
capture that holds `operations` but not `buffers` is reported as answering
`find_operations` and nothing else, rather than advertising every tool and failing most
of them.

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

A range is read only when you ask for one. `top_ops` and `diff_reports` take
`start_signpost` and `end_signpost`, the bounds `tt-perf-report --start-signpost` and
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
both reports, and refuses when only one of them holds signposts: a window compared against
a whole report would show every row outside the window as a change. It checks the range
against both reports before generating either, and a refusal names the report it is about.

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
worse than no answer.

**A total on a partitioned run carries a caveat.** When a report spans more than one
sub-device, operations on different sub-devices can run concurrently, so summed device
time, total percentages and op-to-op gaps overstate elapsed time. Responses that include a
total say so, and name the sub-devices involved — `top_ops` and `diff_reports` alike, since
a delta between two unsound totals is unsound the same way, and `operation_detail` wherever
it returns `report_device_time_total`, since its shares divide by that total.

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
rest (the performance view's counts them as misses), and a caveat says so. When every repeat call that recorded a result missed, the
answer says that is what a run with the program cache disabled records, so check before
reading each miss as a program built again. A capture without the `PROGRAM HASH` and `PROGRAM CACHE HIT`
columns cannot answer, and `load_report` says so. Each op code's first repeat miss is
named by its CSV row in `first_repeat_miss_perf_id`, and when the handle also holds a
profiler report, by `first_repeat_miss_operation_id` too, for `operation_provenance` to
turn into a call site.

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

The link is resolved once per handle, on the first `top_ops`, `program_cache` or
`operation_detail` that needs it, and reads every captured graph at the linked rank. On a handle with both reports,
the first `operation_detail` therefore also generates the performance report, which can
take seconds on a large capture; every later call reuses both. A link that failed on a read
that might pass next time — a locked database, a temp-file error in tt-perf-report — is not
kept, so the next call tries again. A handle keeps answering from the capture it first
read, so it never mixes two. A read that needs the CSV again after it was rewritten, or
after a newer `ops_perf_results` file appeared — a range not asked before, or one dropped
from the cache — is refused rather than lined up against operations linked from the old
capture; call `load_report` again for a fresh handle.

**An operation id is not the end of the answer.** `memory_profile` names the operations
holding its largest footprint, and `operation_provenance` turns such an id into the two things you need
to act on it: the arguments it was called with, and the innermost stack frame's file,
line, function and source line.

`top_ops` names an operation too, but its `id` is a row of the performance CSV and does
not belong here (`diff_reports` returns no id at all: it groups by op code): the two ids are small integers in overlapping
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
