# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Prometheus projection of the bounded local usage event log."""

import logging
import os
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import groupby
from pathlib import Path
from typing import DefaultDict, Dict, Iterable, Optional, Tuple

from ttnn_visualizer.event_logging import (
    get_event_log_path,
    parse_event_log_line,
    parse_known_event_fields,
)
from ttnn_visualizer.usage_collection import (
    MACHINE_ID_LABEL,
    UsageCollectionConfig,
    load_usage_collection_config,
)

logger = logging.getLogger(__name__)

PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"
_READ_CHUNK_BYTES = 64 * 1024
MAX_EVENT_LOG_LINE_BYTES = 4 * 1024
_METRIC_PREFIX = "ttnn_visualizer_"
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


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _render_labels(labels: MetricLabels) -> str:
    """Render labels already sorted by name, as every ``MetricLabels`` is."""
    return ",".join(f'{name}="{_escape_label(value)}"' for name, value in labels)


def _metric_name(suffix: str) -> str:
    return f"{_METRIC_PREFIX}{suffix}"


def _aggregate_lines(
    lines: Iterable[str],
    machine_id: str,
) -> Tuple[Dict[MetricKey, int], int]:
    count_by_series: DefaultDict[MetricKey, int] = defaultdict(int)
    parse_errors = 0
    for line in lines:
        fields = parse_event_log_line(line)
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
    """Increment the cached aggregate from bytes appended since the previous scrape."""
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


def _render_health_metric(name: str, help_text: str, value: int) -> list[str]:
    return [
        f"# HELP {name} {help_text}",
        f"# TYPE {name} gauge",
        f"{name} {value}",
    ]


def render_usage_metrics(
    config: Optional[UsageCollectionConfig] = None,
    *,
    log_path: Optional[Path] = None,
) -> str:
    """Render current cumulative counters, or an empty exposition when disabled."""
    resolved_config = config or load_usage_collection_config()
    if not resolved_config.enabled or resolved_config.machine_id is None:
        return ""

    path = log_path or get_event_log_path()
    count_by_series, parse_errors, files_found, scan_errors = _update_metrics(
        path, resolved_config.machine_id
    )

    output: list[str] = []
    for event_name, series in groupby(
        sorted(count_by_series.items()), key=lambda item: item[0][0]
    ):
        metric_name = _metric_name(f"{event_name}_total")
        output.extend(
            [
                f"# HELP {metric_name} Cumulative {event_name} events in the local usage log.",
                f"# TYPE {metric_name} counter",
            ]
        )
        output.extend(
            f"{metric_name}{{{_render_labels(labels)}}} {value}"
            for (_event_name, labels), value in series
        )

    output.extend(
        _render_health_metric(
            _metric_name("usage_collector_files_found"),
            "Whether the local usage event log exists.",
            files_found,
        )
    )
    output.extend(
        _render_health_metric(
            _metric_name("usage_collector_parse_errors"),
            "Malformed or unsupported lines in the local usage event log.",
            parse_errors,
        )
    )
    output.extend(
        _render_health_metric(
            _metric_name("usage_collector_scan_errors"),
            "Whether reading the local usage event log failed.",
            scan_errors,
        )
    )
    return "\n".join(output) + "\n"
