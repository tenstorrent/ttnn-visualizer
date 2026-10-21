# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Aggregate usage counters from the local event log, exported over OTLP."""

import json
import logging
import os
import subprocess
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import groupby
from pathlib import Path
from typing import Any, DefaultDict, Dict, Iterable, Optional, Tuple

from ttnn_visualizer.event_logging import (
    get_event_log_path,
    is_recording_enabled,
    parse_known_event_fields,
    parse_logfmt_line,
)
from ttnn_visualizer.usage_collection import (
    MACHINE_ID_LABEL,
    METRIC_PREFIX,
    UsageCollectionConfig,
    load_usage_collection_config,
)

logger = logging.getLogger(__name__)

OTLP_CONTENT_TYPE = "application/json"
SERVICE_NAME = "ttnn-visualizer"
SCOPE_NAME = "ttnn_visualizer.usage_metrics"
EXPORT_INTERVAL_SECONDS = 60.0
EXPORT_TIMEOUT_SECONDS = 10.0
CURL_COMMAND = "curl"
# ``AGGREGATION_TEMPORALITY_CUMULATIVE`` in the OTLP metrics protocol.
_CUMULATIVE_TEMPORALITY = 2
_READ_CHUNK_BYTES = 64 * 1024
MAX_EVENT_LOG_LINE_BYTES = 4 * 1024
MetricLabels = Tuple[Tuple[str, str], ...]
# Keyed by event name rather than metric name, so the name is built in one place.
MetricKey = Tuple[str, MetricLabels]


@dataclass
class _MetricsState:
    path: Optional[Path] = None
    machine_id: Optional[str] = None
    device: Optional[int] = None
    inode: Optional[int] = None
    offset: int = 0
    pending: bytes = b""
    discarding_overlong_line: bool = False
    count_by_series: DefaultDict[MetricKey, int] = field(
        default_factory=lambda: defaultdict(int)
    )
    parse_errors: int = 0


_metrics_state = _MetricsState()
_metrics_lock = threading.Lock()


def _metric_name(suffix: str) -> str:
    return f"{METRIC_PREFIX}{suffix}"


def _aggregate_lines(
    lines: Iterable[str],
    machine_id: str,
) -> Tuple[Dict[MetricKey, int], int]:
    count_by_series: DefaultDict[MetricKey, int] = defaultdict(int)
    parse_errors = 0
    for line in lines:
        fields = parse_logfmt_line(line)
        parsed = parse_known_event_fields(fields) if fields is not None else None
        if parsed is None:
            parse_errors += 1
            continue
        event, labels, count = parsed
        labels[MACHINE_ID_LABEL] = machine_id
        count_by_series[(event.value, tuple(sorted(labels.items())))] += count
    return dict(count_by_series), parse_errors


def _reset_metrics_state(path: Path, machine_id: str) -> _MetricsState:
    global _metrics_state
    _metrics_state = _MetricsState(path=path, machine_id=machine_id)
    return _metrics_state


def _update_metrics(
    path: Path, machine_id: str
) -> Tuple[Dict[MetricKey, int], int, int, int]:
    """Increment the cached aggregate from bytes appended since the previous push."""
    # The first call reads the whole log while holding this lock; every later call
    # reads only what was appended. That cold read is bounded by the log's size cap
    # (`MAX_LOG_BYTES`) and took about 0.3 s at the cap against 0.1 ms warm. It runs on
    # the exporter's own thread in the launcher process, so it never pauses a request.
    with _metrics_lock:
        state = _metrics_state
        if state.path != path or state.machine_id != machine_id:
            state = _reset_metrics_state(path, machine_id)

        try:
            with path.open("rb") as log_file:
                stat_result = os.fstat(log_file.fileno())
                replaced = state.device is not None and (state.device, state.inode) != (
                    stat_result.st_dev,
                    stat_result.st_ino,
                )
                if replaced or stat_result.st_size < state.offset:
                    state = _reset_metrics_state(path, machine_id)

                state.device = stat_result.st_dev
                state.inode = stat_result.st_ino
                log_file.seek(state.offset)

                pending = state.pending
                discarding_overlong_line = state.discarding_overlong_line
                added_count_by_series: DefaultDict[MetricKey, int] = defaultdict(int)
                parse_errors = 0
                while appended := log_file.read(_READ_CHUNK_BYTES):
                    lines = []
                    segments = appended.split(b"\n")
                    for index, segment in enumerate(segments):
                        terminated = index < len(segments) - 1
                        if discarding_overlong_line:
                            if terminated:
                                discarding_overlong_line = False
                            continue
                        if len(pending) + len(segment) > MAX_EVENT_LOG_LINE_BYTES:
                            pending = b""
                            parse_errors += 1
                            discarding_overlong_line = not terminated
                            continue
                        pending += segment
                        if terminated:
                            if pending:
                                lines.append(pending.decode("utf-8", errors="replace"))
                            pending = b""
                    chunk_count_by_series, chunk_errors = _aggregate_lines(
                        lines, machine_id
                    )
                    for key, value in chunk_count_by_series.items():
                        added_count_by_series[key] += value
                    parse_errors += chunk_errors
                new_offset = log_file.tell()
        except FileNotFoundError:
            state = _reset_metrics_state(path, machine_id)
            return {}, 0, 0, 0
        except OSError as error:
            logger.warning("Unable to read usage event log for metrics: %s", error)
            return dict(state.count_by_series), state.parse_errors, 1, 1

        for key, value in added_count_by_series.items():
            state.count_by_series[key] += value
        state.parse_errors += parse_errors
        state.pending = pending
        state.discarding_overlong_line = discarding_overlong_line
        state.offset = new_offset

        return dict(state.count_by_series), state.parse_errors, 1, 0


@dataclass(frozen=True)
class UsageMetricsSnapshot:
    count_by_series: Dict[MetricKey, int]
    parse_errors: int
    files_found: int
    scan_errors: int


def collect_usage_metrics(
    config: Optional[UsageCollectionConfig] = None,
    *,
    log_path: Optional[Path] = None,
) -> Optional[UsageMetricsSnapshot]:
    """Current cumulative counters, or ``None`` when collection is disabled."""
    resolved_config = config or load_usage_collection_config()
    if not resolved_config.enabled or resolved_config.machine_id is None:
        return None

    path = log_path or get_event_log_path()
    return UsageMetricsSnapshot(*_update_metrics(path, resolved_config.machine_id))


def _attributes(labels: MetricLabels) -> list[Dict[str, Any]]:
    return [{"key": name, "value": {"stringValue": value}} for name, value in labels]


def _data_point(
    labels: MetricLabels, value: int, start_time_ns: int, time_ns: int
) -> Dict[str, Any]:
    # 64-bit integers are strings in OTLP JSON, as in every proto3 JSON mapping.
    return {
        "attributes": _attributes(labels),
        "startTimeUnixNano": str(start_time_ns),
        "timeUnixNano": str(time_ns),
        "asInt": str(value),
    }


def _counter(
    name: str, description: str, data_points: list[Dict[str, Any]]
) -> Dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "sum": {
            "aggregationTemporality": _CUMULATIVE_TEMPORALITY,
            "isMonotonic": True,
            "dataPoints": data_points,
        },
    }


def _gauge(name: str, description: str, data_point: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "gauge": {"dataPoints": [data_point]},
    }


def build_otlp_payload(
    snapshot: UsageMetricsSnapshot,
    machine_id: str,
    *,
    start_time_ns: int,
    time_ns: int,
) -> Dict[str, Any]:
    """An OTLP/HTTP JSON ``ExportMetricsServiceRequest`` for the snapshot.

    Counter names keep their ``_total`` suffix: Prometheus' OTLP translation removes
    and re-appends it, so the stored name is the same whether or not it adds suffixes.
    """
    metrics: list[Dict[str, Any]] = []
    for event_name, series in groupby(
        sorted(snapshot.count_by_series.items()), key=lambda item: item[0][0]
    ):
        metrics.append(
            _counter(
                _metric_name(f"{event_name}_total"),
                f"Cumulative {event_name} events in the local usage log.",
                [
                    _data_point(labels, value, start_time_ns, time_ns)
                    for (_event_name, labels), value in series
                ],
            )
        )

    identity: MetricLabels = ((MACHINE_ID_LABEL, machine_id),)
    metrics.extend(
        [
            _gauge(
                _metric_name("usage_collector_files_found"),
                "Whether the local usage event log exists.",
                _data_point(identity, snapshot.files_found, start_time_ns, time_ns),
            ),
            _counter(
                _metric_name("usage_collector_parse_errors_total"),
                "Cumulative malformed or unsupported lines in the local usage event log.",
                [_data_point(identity, snapshot.parse_errors, start_time_ns, time_ns)],
            ),
            _gauge(
                _metric_name("usage_collector_scan_errors"),
                "Whether reading the local usage event log failed.",
                _data_point(identity, snapshot.scan_errors, start_time_ns, time_ns),
            ),
        ]
    )
    return {
        "resourceMetrics": [
            {
                "resource": {
                    "attributes": _attributes((("service.name", SERVICE_NAME),))
                },
                "scopeMetrics": [{"scope": {"name": SCOPE_NAME}, "metrics": metrics}],
            }
        ]
    }


def _quote_curl_config(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _post_with_curl(endpoint: str, body: str, auth_token: Optional[str]) -> None:
    """POST through the system ``curl``, which trusts the OS certificate store.

    Every option, including the token and the body, goes in a config read from stdin,
    so neither appears in the process list. Redirects are not followed, so the token
    is never resent to another host, and anything but a 2xx is an error.
    """
    options = {
        "url": endpoint,
        "request": "POST",
        "header": f"Content-Type: {OTLP_CONTENT_TYPE}",
        "data-binary": body,
        "output": os.devnull,
        "write-out": "%{http_code}",
        "max-time": str(int(EXPORT_TIMEOUT_SECONDS)),
        "proto": "=http,https",
    }
    lines = [f"{name} = {_quote_curl_config(value)}" for name, value in options.items()]
    if auth_token:
        lines.append(
            f"header = {_quote_curl_config(f'Authorization: Bearer {auth_token}')}"
        )
    lines.extend(["silent", "show-error"])

    try:
        result = subprocess.run(
            [CURL_COMMAND, "--config", "-"],
            input="\n".join(lines) + "\n",
            capture_output=True,
            text=True,
            # Beyond curl's own ``max-time``, so curl reports the timeout itself.
            timeout=EXPORT_TIMEOUT_SECONDS + 5,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise TimeoutError("curl did not finish") from error
    if result.returncode != 0:
        raise OSError(f"curl exited with {result.returncode}: {result.stderr.strip()}")
    status = result.stdout.strip()
    if not status.startswith("2"):
        raise OSError(f"endpoint answered HTTP {status}")


def push_usage_metrics(*, start_time_ns: int, log_path: Optional[Path] = None) -> bool:
    """Send the current counters to the configured endpoint.

    Returns whether anything was sent. Rereads the opt-outs and the config on every
    call, so switching either off stops the next push without a restart. Raises
    ``OSError`` when the request fails, including on a non-2xx response or when
    ``curl`` is not installed.
    """
    if not is_recording_enabled():
        return False
    config = load_usage_collection_config()
    if config.remote_write_endpoint is None or config.machine_id is None:
        return False
    snapshot = collect_usage_metrics(config, log_path=log_path)
    if snapshot is None:
        return False

    payload = build_otlp_payload(
        snapshot,
        config.machine_id,
        start_time_ns=start_time_ns,
        time_ns=time.time_ns(),
    )
    _post_with_curl(
        config.remote_write_endpoint,
        json.dumps(payload),
        config.remote_write_auth_token,
    )
    return True


class UsageMetricsExporter:
    """Pushes the counters once at start, then every interval, then once on stop.

    Runs in the launcher process rather than in gunicorn, so one exporter serves
    however many workers there are.
    """

    def __init__(self, interval_seconds: float = EXPORT_INTERVAL_SECONDS) -> None:
        self._interval_seconds = interval_seconds
        self._start_time_ns = time.time_ns()
        self._stopping = threading.Event()
        self._failing = False
        self._thread = threading.Thread(
            target=self._run, name="usage-metrics-exporter", daemon=True
        )

    def start(self) -> "UsageMetricsExporter":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stopping.set()
        self._thread.join(timeout=EXPORT_TIMEOUT_SECONDS)
        # Final push, so a session shorter than one interval is still counted.
        self._push()

    def _run(self) -> None:
        self._push()
        while not self._stopping.wait(self._interval_seconds):
            self._push()

    def _push(self) -> None:
        try:
            push_usage_metrics(start_time_ns=self._start_time_ns)
        except OSError as error:
            # Logged once per run of failures rather than every interval.
            if not self._failing:
                logger.warning("Unable to export usage metrics: %s", error)
            self._failing = True
        else:
            self._failing = False
