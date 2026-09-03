<!--
SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
-->

# Event logging

TT-NN Visualizer records a small, fixed set of usage events on local installations. Recording is on by default. The application writes the events to a file on the same machine and does not transmit them.

The hosted instance at [ttnn-visualizer.tenstorrent.com](https://ttnn-visualizer.tenstorrent.com) runs in `SERVER_MODE` and records no usage events.

## Storage and inspection

Usage data always lives at:

```text
~/.ttnn-visualizer/usage/events.log
```

This path is separate from the application data directory. Deleting the application data directory, including a directory selected through `TT_METAL_HOME` or `APP_DATA_DIRECTORY`, does not delete the usage log.

The log is plain text in logfmt format. Inspect it with:

```shell
cat ~/.ttnn-visualizer/usage/events.log
```

Stop TT-NN Visualizer before deleting the log; a running process can create it again. Delete the recorded events with:

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

Recording resumes after the marker is removed unless `USAGE_RECORDING_DISABLED` still disables it. Neither local control can enable recording under `SERVER_MODE`.

## Log fields

Ordinary event lines contain these common fields:

- `ts`: the UTC time at which the server wrote the event, in `YYYY-MM-DDTHH:MM:SSZ` form. Frontend events are buffered, so this can be later than the interaction.
- `event`: one of `app_start`, `report_loaded`, `report_load_failed`, `view_opened`, or `view_engaged`.
- `schema_version`: the log format version, currently `1`.
- `run_id`: a random `8`-character identifier generated for each application launch and shared by its server workers. It is not persisted between launches and is never exported by the out-of-band collector.

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

`hosted` is part of the closed `launch_mode` vocabulary, but an application running in `SERVER_MODE` disables recording before this event is written.

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

TT-NN Visualizer only writes the local log. It makes no off-machine usage-reporting request and has no knowledge of whether another process reads the file.

On a managed machine, an independently operated collector can read the log and export machine-level aggregate counters. The collector must not export timestamps, `run_id`, per-event rows, or per-user series. Deleting or disabling the local log is independent of that collector and does not remove aggregates it has already exported.

## Documentation-site analytics

The Sphinx documentation site can use PostHog for documentation feedback and traffic. That site analytics system is separate from TT-NN Visualizer's local usage log: documentation traffic and application usage are complementary signals, but they measure different populations and must not be combined or directly compared.
