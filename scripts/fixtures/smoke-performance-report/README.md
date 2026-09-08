# Smoke test performance report fixture

The performance report `scripts/smoke_test.py` uploads to cover
`POST /api/local/upload/performance` and the `/api/performance/*` routes (#1859).

This is a **CI fixture, not a demo report.** The archives in `demo-reports/` are
user-facing artifacts whose device logs run 3.5–36 MB; pushing one of those
through a browser upload on five Python versions per run is far more than this
coverage needs. This directory is ~55 KB.

## Provenance

Distilled from `demo-reports/n300-llama.zip`
(`local/performance-reports/DEMO_N300-LLAMA/`) by:

```
uv run python scripts/generate_smoke_perf_fixture.py \
    --source demo-reports/n300-llama.zip \
    --output scripts/fixtures/smoke-performance-report
```

Re-running that command against the same source reproduces this directory
byte-for-byte, so `git status` staying clean is the check that nothing drifted.
The generator rewrites its output directory from scratch but carries this
README across, so regenerating in place does not cost you these notes.

Two guards on `--output`, since it is deleted and recreated: it must name a
directory inside `scripts/fixtures/`, and it may not be that root itself — a
typo can't take a real tree with it. `scripts/tests/test_generate_smoke_perf_fixture.py`
pins both.

`backend/ttnn_visualizer/tests/test_smoke_perf_fixture.py` asserts the
invariants below against the committed bytes, so a bad regeneration fails in
seconds rather than waiting on the Playwright matrix.

## What matters if you regenerate it

- **Rows are trimmed; columns never are.** `/api/performance/perf-results/report`
  hands `ops_perf_results.csv` to the pinned external `tt-perf-report`, which
  reads many more columns than this repo names. A hand-picked column subset can
  break inside that library without any signal here.
- **The first two lines of `profile_log_device.csv` are verbatim.** Line 1 is
  what `/api/performance/device-log/meta` regex-parses for `ARCH:` and
  `CHIP_FREQ[MHz]:`. Line 2 is the header, which `DeviceLogProfilerQueries` reads
  **by name** after stripping whitespace, checking it against
  `REQUIRED_DEVICE_LOG_COLUMNS`; extra columns pass through. This file keeps its
  13-column shape deliberately — a current tt-metal emits 15, and having both
  shapes covered is what stops the reader regressing to a positional read
  (#1941).
- **`npe_viz/manifest.json` is generated from the retained rows.**
  `PerfTable` only renders the NPE launch button when a manifest entry's
  `global_call_count` matches a report row's, and the smoke test clicks that
  button to reach `/api/performance/npe/timeline`. The manifest must also stay
  schema-clean per `src/schemas/npe-manifest.schema.json`
  (`additionalProperties: false`) — note the source manifest in the demo report
  has a typo'd `_global_call_count` key that would fail that schema.
- **No `tracy_profile_log_host.tracy`.** It is optional per
  `PERFORMANCE_REPORT_REQUIRED_FILES`, and omitting it keeps the tracy-less
  ingestion path covered.

This directory lives under `scripts/` deliberately: `setuptools` packages only
`backend/`, so the fixture stays out of the built wheel.
