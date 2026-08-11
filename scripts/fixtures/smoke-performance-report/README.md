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

Re-running that command against the same source reproduces this directory.

## What matters if you regenerate it

- **Rows are trimmed; columns never are.** `/api/performance/perf-results/report`
  hands `ops_perf_results.csv` to the pinned external `tt-perf-report`, which
  reads many more columns than this repo names. A hand-picked column subset can
  break inside that library without any signal here.
- **The first two lines of `profile_log_device.csv` are verbatim.** Line 1 is
  what `/api/performance/device-log/meta` regex-parses for `ARCH:` and
  `CHIP_FREQ[MHz]:`; `LocalCSVQueryRunner` reads the file with `skiprows=1` and
  then overwrites the header positionally, so the row shape is what counts.
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
