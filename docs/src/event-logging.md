<!--
SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
-->

# Event logging

TT-NN Visualizer records a small, fixed set of events. Recording is on by default. The frontend posts events to the TT-NN Visualizer backend, which stores them on its own machine and never forwards raw events. Aggregate counts leave the machine only through opt-in. On a local installation that request remains on the local machine; under `SERVER_MODE` it travels from the user's browser to the hosted backend.

## Storage and inspection

Local event-log data lives at:

```text
~/.ttnn-visualizer/usage/events.log
```

This path is separate from the application data directory. Deleting the application data directory, including a directory selected through `TT_METAL_HOME` or `APP_DATA_DIRECTORY`, does not delete the event log.

An installation running in `SERVER_MODE` stores one log per anonymous browser session:

```text
/data/usage/<event-log-id>/events.log
```

The backend generates the 32-character event log ID and stores it inside the signed Flask session cookie. It is a log partition key, not Flask's session identifier or a user identity. It is never accepted from a request parameter or body, never written into an event line, and must not be exported by any collector. It normally lasts for the browser session; uploading a report makes the existing Flask session permanent for Flask's default 31-day lifetime.

`SERVER_MODE` refuses to start unless `SECRET_KEY` is non-default and at least 8 bytes excluding surrounding whitespace. Padding is not counted toward that floor, but it is not removed either — the configured value is what signs the cookie, so tidying whitespace out of an accepted key rotates the signing key and drops every session. That is a floor against an obviously-short key rather than a strength check, so operators should still supply a long random value. The application accepts at most 1,024 hosted event logs, at most 60 new event logs per minute across workers, and at most 120 batches per event log per minute in each worker. Combined with the 10 MiB per-file cap, the log-count limit bounds aggregate event-file storage to approximately 10 GiB. Hosted deployments must still mount writable persistent storage at `/data/usage`, remove collected session logs to reclaim quota, and apply edge-level request controls appropriate to their worker count and expected traffic.

The log is plain text in logfmt format. Inspect it with:

```shell
cat ~/.ttnn-visualizer/usage/events.log
```

Stop TT-NN Visualizer before deleting logs; a running process can create them again. Delete locally recorded events with:

```shell
rm -f ~/.ttnn-visualizer/usage/events.log
```

Deleting the log does not disable future recording.

## Disabling recording

Set the environment variable before launching the application:

```shell
USAGE_RECORDING_DISABLED=true ttnn-visualizer
```

`USAGE_RECORDING_DISABLED` is an opt-out. Leaving it unset, or setting it to `false` or `0`, keeps recording on. Setting it to `true` or `1` switches recording off. An unrecognised value also switches recording off, so a misspelled opt-out cannot accidentally leave recording enabled; the startup output reports the unrecognised value beside the disabled status.

For an opt-out that applies across shells, create the marker file:

```shell
mkdir -p ~/.ttnn-visualizer/usage
touch ~/.ttnn-visualizer/usage/disabled
```

Under `SERVER_MODE`, create `/data/usage/disabled` instead. The marker applies to every hosted session. Recording resumes after the posture's marker is removed unless `USAGE_RECORDING_DISABLED` still disables it.

## Log fields

Ordinary event lines contain these common fields:

- `ts`: the UTC time at which the server wrote the event, in `YYYY-MM-DDTHH:MM:SSZ` form. Frontend events are buffered, so this can be later than the interaction.
- `event`: one of `app_start`, `report_loaded`, `report_load_failed`, `view_opened`, `view_engaged`, or `mcp_tool_called`.
- `schema_version`: the log format version, currently `1`.
- `run_id`: a random `8`-character identifier generated for each backend launch and shared by its server workers. It is not persisted between launches and is never exported, either by the local metrics projection or by a hosted collector. Hosted browser-session identity comes from the containing directory, not this field.

After the log is compacted, a summary line can contain:

- `count`: the number of equivalent events represented by the summary, instead of `run_id`. When `count` is absent, the line represents one event.

## Recorded events

The fields below are the complete event-specific vocabulary. Every listed set of values is closed: the server rejects other values rather than writing arbitrary text.

### `app_start`

Recorded by the server once during a successful local launch.

- `version`: the TT-NN Visualizer version, or `unknown` when it cannot be determined.
- `deployment_mode`: `tt_metal_home`, `container`, `local_upload`.
- `launch_mode`: `source`, `wheel`, `hosted`.
- `os`: `darwin`, `linux`, `windows`, `other`.
- `python_version`: the Python major and minor version, such as `3.10`.

`hosted` remains part of the closed `launch_mode` vocabulary, but `app_start` is not written under `SERVER_MODE`: a shared server process launch is not a browser session or evidence of user activity.

### `report_loaded`

Recorded after a report is loaded successfully.

- `kind`: `profiler`, `performance`, `npe`, `mlir`, `cluster_descriptor`.
- `source`: `upload`, `remote_sync`, `local_tt_metal`, `demo`.
  - `upload`: a report uploaded from the browser. Under `SERVER_MODE`, this also counts every reselection of one of the session's earlier uploads from the report list, so hosted `upload` counts are loads, not uploads.
  - `remote_sync`: a report synced from a remote host.
  - `local_tt_metal`: a report selected from the local installation's report folders. Without `TT_METAL_HOME`, uploads are saved into those same folders, so this includes reselecting an earlier upload on a local installation. Never recorded under `SERVER_MODE`.
  - `demo`: a bundled demo report. That is any NPE demo, and, under `SERVER_MODE`, any profiler or performance report in one of the folders unpacked from `demo-reports/`, such as `WH_DEMO_N300-LLAMA` or `BH_DEMO_bge_m3`. The exact folder names are listed in `DEMO_PROFILER_DIRECTORY_NAMES` and `DEMO_PERFORMANCE_DIRECTORY_NAMES` in `views.py`.

Because reselected uploads count as `upload` when hosted but as `local_tt_metal` locally, do not compare upload share between hosted and local logs.

Before 0.107.0, hosted event logs tagged every report picked from the hosted report list as `local_tt_metal`. Hosted logs carry no version, since `app_start` is not written under `SERVER_MODE`, so find the cut-over from the 0.107.0 deploy date. Read hosted `local_tt_metal` counts from before it as demo loads or reselected uploads, not as a tt-metal checkout.

### `report_load_failed`

Recorded after a report cannot be loaded.

- `kind`: `profiler`, `performance`, `npe`, `mlir`, `cluster_descriptor`.
- `reason_class`: `unsupported_version`, `missing_file`, `parse_error`, `too_large`, `permission`, `other`.

The reason is deliberately classified rather than copied from an error message.

### `view_opened`

Recorded when a counted application view is opened.

- `view`: `reports`, `operations`, `operation_details`, `tensors`, `buffers`, `graph`, `performance`, `npe`, `mlir`, `topology`, `mcp`.

### `view_engaged`

Recorded once when a counted view has remained open for 10 seconds and receives at least one deliberate pointer or keyboard interaction within the active view content. Global navigation, pointer movement, hover, and scrolling do not qualify, and neither does interaction inside drawers, dialogs, and popovers that render outside the view content; opening one from the view already counts. The interaction can happen before or after the 10-second threshold.

This is the intentionally revisable v1 definition of deliberate activity used for reach and repeat-use decisions (Q1 and Q2 in #1819). Changing the threshold affects future events only.

- `view`: `reports`, `operations`, `operation_details`, `tensors`, `buffers`, `graph`, `performance`, `npe`, `mlir`, `topology`, `mcp`.

### `mcp_tool_called`

Recorded by `ttnn-visualizer-mcp` when a registered tool reaches its handler, not by the SPA. It answers which tools are chosen and how often they refuse or fail (Q4 and Q5 in #1819). It does not fire on `initialize`, `ping`, `tools/list`, unknown tool names, or malformed `params`/`arguments`: only calls that get as far as a handler are counted.

- `tool`: `load_report`, `top_ops`, `op_breakdown`, `program_cache`, `zone_timings`, `diff_reports`, `find_operations`, `operation_detail`, `memory_profile`, `tensor_flow`, `operation_provenance`, `errors`, `dram_fallbacks`, `l1_peak`.
- `outcome`: `ok`, `refused`, `error`.

`refused` is a tool declining a well-formed call it cannot answer (unknown handle, argument out of range). `error` is an unexpected failure the server did not anticipate.

## Information that is not recorded

TT-NN Visualizer does not record:

- report, file, folder, or directory names;
- operation names, tensor shapes, kernel names, or other values read from report contents;
- model names or identifiers;
- hostnames, usernames, IP addresses, or SSH targets;
- search or filter text;
- stack traces or error message bodies;
- raw counts that could identify a specific workload;
- client-supplied free-form event details. Client detail fields use closed enums; server-generated version fields are validated before they are written.

## Aggregate collection

The TT-NN Visualizer backend never forwards raw events. When a local install opts in, the launcher projects the local log into cumulative counters and pushes them to a configured endpoint as OTLP/HTTP JSON: once at launch, then every minute, then once when the server stops. Collection is disabled by default and is unavailable under `SERVER_MODE`. Either recording opt-out stops the next push without a restart; a launch under an opt-out starts no exporter at all, so lifting the opt-out mid-session takes effect at the next launch.

The opt-in file is:

```text
~/.ttnn-visualizer/usage/collection.json
```

```json
{
  "enabled": true,
  "remote_write_endpoint": "https://metrics.example/api/v1/otlp/v1/metrics",
  "remote_write_auth_token": "<token>"
}
```

It contains the explicit `enabled` flag, the metrics endpoint, which must accept OTLP/HTTP JSON rather than Prometheus remote-write despite the `remote_write_` key names, an optional `remote_write_auth_token` for that endpoint, and a random persistent `machine_id`. Nothing is collected without an endpoint. The ID is generated at the first launch with collection enabled; it is not derived from a hostname, username, path, or IP address. Deleting the config disables collection and causes a new identity to be generated if collection is enabled again. The exporter rereads the config before every push, so disabling or deleting it takes effect within a minute. Enabling collection or adding an endpoint takes effect at the next launch, because the exporter only starts at launch. A malformed config fails closed without preventing TT-NN Visualizer from starting. The token field was named `remote_write_bearer_token` before this release; a config still using that name fails closed with a warning naming the new field. If an earlier release's `pnpm prometheus:config` wrote a `prometheus.remote-write.token` file, delete it.

The endpoint must use HTTPS unless it is a loopback address, and must not contain whitespace, control characters, credentials, query parameters, or a fragment. A Prometheus remote-write path (`/api/v1/write`, `/api/v1/push`), as configs for earlier releases used, fails the config closed, since it cannot take OTLP. When the endpoint answers 4xx, the logged warning says it must accept OTLP/HTTP JSON. The token is sent as an `Authorization: Bearer` header; it requires an endpoint and must not contain whitespace or control characters, and a token that breaks either rule fails the whole config closed. `collection.json` is kept at mode `0600`. Pushes are sent with the system `curl`, which must be on `PATH`; it verifies TLS against the operating system's trust store, so an endpoint signed by an internal CA installed on the machine is trusted. The token and payload are passed to `curl` on standard input, never on its command line, and `curl` is run with `-q` so a user's `~/.curlrc` cannot change these options. Redirects are refused, so the token is never resent to another host, and URL globbing is off, so `{}` or `[]` in the endpoint cannot turn one push into several. A loopback endpoint bypasses any configured `http_proxy` or `ALL_PROXY`, so a token sent over plain HTTP never leaves the machine. Without a token, pushes are unauthenticated. A failed push is logged once until a later push succeeds; the counters are cumulative, so the next successful push carries everything missed.

The projection exports one `_total` counter per event name with only that event's documented fields and `machine_id` as attributes, under the resource attribute `service.name="ttnn-visualizer"`. It honours compacted `count` values. It never exports timestamps of events, `run_id`, hosted session directory names, raw event rows, usernames, hostnames, paths, or unknown fields. The counters carry no start time, because they total a log that outlives any one launch; receivers treat each value as following the last, so a relaunch is not read as a counter reset. Collector health metrics distinguish a missing log, malformed lines, and a read failure. Deleting the event log resets the projected counters; compaction preserves them.

The pushes come from the `ttnn-visualizer` launcher, not the gunicorn workers, so one exporter serves any number of workers. Under `--daemon` the launcher exits as soon as gunicorn detaches, so both of its pushes happen at launch; usage from a daemon session is only sent by the next launch with collection enabled. The final push on exit is limited to a few seconds, and is skipped if an earlier push is still in flight, so a slow endpoint cannot hold up shutdown. Any local process can append to the event log and so inflate the counts. Treat per-machine counts as indicative rather than trustworthy.

## Hosted collection

The hosted app has no collection beyond the event log itself: aggregate collection is unavailable under `SERVER_MODE`, and the application exports nothing from the session logs. Hosted retention and compaction are the deployment's responsibility; the application neither enumerates session logs at startup nor compacts them on a request path. Anything a deployment builds to read those logs must not export timestamps, `run_id`, hosted session directory names, per-event rows, or per-user series.

## Documentation-site analytics

The Sphinx documentation site can use PostHog for documentation feedback and traffic. That site analytics system is separate from TT-NN Visualizer's event logs: documentation traffic and application activity are complementary signals, but they measure different populations and must not be combined or directly compared.
