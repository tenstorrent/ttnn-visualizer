<!--
SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
-->

# Event logging

TT-NN Visualizer records a small, fixed set of usage events. Recording is on by default. The frontend posts events to the TT-NN Visualizer backend, which stores them on its own machine and does not forward or export them. On a local installation that request remains on the local machine; under `SERVER_MODE` it travels from the user's browser to the hosted backend.

## Storage and inspection

Local usage data lives at:

```text
~/.ttnn-visualizer/usage/events.log
```

This path is separate from the application data directory. Deleting the application data directory, including a directory selected through `TT_METAL_HOME` or `APP_DATA_DIRECTORY`, does not delete the usage log.

An installation running in `SERVER_MODE` stores one log per anonymous browser session:

```text
/data/usage/<event-log-id>/events.log
```

The backend generates the 32-character event log ID and stores it inside the signed Flask session cookie. It is a log partition key, not Flask's session identifier or a user identity. It is never accepted from a request parameter or body, never written into an event line, and must not be exported by the collector. It normally lasts for the browser session; uploading a report makes the existing Flask session permanent for Flask's default 31-day lifetime. Hosted deployments must provide a strong, stable `SECRET_KEY`, mount writable persistent storage at `/data/usage`, and enforce aggregate retention, quota, and request-rate controls.

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
- `event`: one of `app_start`, `report_loaded`, `report_load_failed`, `view_opened`, or `view_engaged`.
- `schema_version`: the log format version, currently `1`.
- `run_id`: a random `8`-character identifier generated for each backend launch and shared by its server workers. It is not persisted between launches and is never exported by the out-of-band collector. Hosted browser-session identity comes from the containing directory, not this field.

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

### `report_load_failed`

Recorded after a report cannot be loaded.

- `kind`: `profiler`, `performance`, `npe`, `mlir`, `cluster_descriptor`.
- `reason_class`: `unsupported_version`, `missing_file`, `parse_error`, `too_large`, `permission`, `other`.

The reason is deliberately classified rather than copied from an error message.

### `view_opened`

Recorded when a counted application view is opened.

- `view`: `reports`, `operations`, `operation_details`, `tensors`, `buffers`, `graph`, `performance`, `npe`, `mlir`, `topology`.

### `view_engaged`

Defined for a deliberate interaction with a view after it has remained open. The current frontend does not yet emit this event.

- `view`: `reports`, `operations`, `operation_details`, `tensors`, `buffers`, `graph`, `performance`, `npe`, `mlir`, `topology`.

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

## Out-of-band collection

The TT-NN Visualizer backend only writes the logs; it does not forward or export them and has no knowledge of whether another process reads the files. Under `SERVER_MODE`, the browser-to-backend event request is necessarily a network request to the hosted application.

An independently operated collector can read the logs and export aggregate counters. The collector must not export timestamps, `run_id`, hosted session directory names, per-event rows, or per-user series. Hosted retention and compaction are collector/deployment responsibilities; the application neither enumerates session logs at startup nor compacts them on a request path. Deleting or disabling a log is independent of that collector and does not remove aggregates it has already exported.

## Documentation-site analytics

The Sphinx documentation site can use PostHog for documentation feedback and traffic. That site analytics system is separate from TT-NN Visualizer's usage logs: documentation traffic and application usage are complementary signals, but they measure different populations and must not be combined or directly compared.
