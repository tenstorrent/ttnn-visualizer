# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Local-only usage event log.

The application appends one ``key=value`` line per event to a file under a fixed
path in the user's home directory. Nothing is ever sent anywhere: if the file is
not read by an out-of-band collector, no usage data leaves the machine at all.

Two properties this file's consumers depend on, stated here because they are not
obvious from the code that reads it:

* **Every line contributes ``count`` events, defaulting to 1 when the field is
  absent.** Compaction replaces a span of lines with one summary line per
  distinct field combination, carrying the total as ``count``. A collector that
  assumes one line means one event will under-count after the first compaction,
  and cumulative totals that go down are read by Prometheus as a counter reset.
* **Lines may occasionally be malformed and should be skipped, not fatal.**
  Concurrency is handled by ``O_APPEND`` rather than a lock, which is atomic on a
  local filesystem but not over NFS. On an NFS-mounted home two instances writing
  at once can interleave a line.

Every recorded value comes from a closed enum, a bucketed value, or the
application's own version. No report, file, directory, operation or host names,
and no free-form text, may ever be written here.
"""

import logging
import os
import platform
import re
import sys
import uuid
from datetime import datetime, timezone
from enum import Enum
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as distribution_version
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ttnn_visualizer.utils import (
    is_running_in_container,
    read_version_from_package_json,
    str_to_bool,
)

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1

# Deliberately not get_app_data_directory(): two of its four branches are derived
# from the environment (TT_METAL_HOME, $APP_DATA_DIRECTORY), and a collector running
# as root has no access to the user's shell environment, so it could only find those
# by crawling home directories. This path is an interface to another team — narrow,
# fixed and documented — while the app data directory is an implementation detail
# that has already moved once.
USAGE_DIRECTORY = Path.home() / ".ttnn-visualizer" / "usage"
USAGE_LOG_NAME = "events.log"
DISABLED_MARKER_NAME = "disabled"
COMPACTION_LOCK_NAME = ".compaction.lock"

USAGE_RECORDING_ENV_VAR = "USAGE_RECORDING_ENABLED"
RUN_ID_ENV_VAR = "TTNN_VISUALIZER_RUN_ID"

# ~110 bytes a line and ~250 events a day for a heavy user is ~27 KB/day, so this
# holds roughly a year before compaction. The cap is a privacy control as much as a
# disk one.
MAX_LOG_BYTES = 10 * 1024 * 1024

# Only has to be unique within one machine's log for one sitting, and is never
# exported, so a full 32-character UUID would be 24 wasted bytes on every line.
RUN_ID_LENGTH = 8

TIMESTAMP_FIELD = "ts"
EVENT_FIELD = "event"
SCHEMA_VERSION_FIELD = "schema_version"
RUN_ID_FIELD = "run_id"
COUNT_FIELD = "count"

# UTC, fixed width. `datetime.isoformat()` would give microseconds and `+00:00`
# rather than `Z`, which is neither fixed width nor the form the collector parses.
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

DISTRIBUTION_NAME = "ttnn_visualizer"
UNKNOWN_VALUE = "unknown"

# logfmt values are unquoted, so a value carrying a space, an `=` or a newline could
# forge extra fields or whole extra events. Enum members, versions and timestamps all
# fit inside this set; anything that doesn't is a bug rather than a value to escape.
_SAFE_VALUE_PATTERN = re.compile(r"^[A-Za-z0-9._:+-]+$")

# Fields that identify a single line rather than a class of them, and so cannot
# survive being summarised into a count.
_UNSUMMARISABLE_FIELDS = (TIMESTAMP_FIELD, RUN_ID_FIELD, COUNT_FIELD)

_run_id: Optional[str] = None


class UsageEvent(str, Enum):
    APP_START = "app_start"


class DeploymentMode(str, Enum):
    TT_METAL_HOME = "tt_metal_home"
    CONTAINER = "container"
    LOCAL_UPLOAD = "local_upload"


class OperatingSystem(str, Enum):
    DARWIN = "darwin"
    LINUX = "linux"
    WINDOWS = "windows"
    OTHER = "other"


def get_usage_directory() -> Path:
    """The one fixed location usage data is written to."""
    return USAGE_DIRECTORY


def get_usage_log_path() -> Path:
    return get_usage_directory() / USAGE_LOG_NAME


def get_disabled_marker_path() -> Path:
    return get_usage_directory() / DISABLED_MARKER_NAME


def _as_bool(value: Any) -> bool:
    """Coerce a config value that may have been stringified by the environment.

    ``DefaultConfig.override_with_env_variables`` copies raw environment strings over
    class attributes, so a config built with ``SERVER_MODE=false`` in ``.env`` carries
    the *string* ``"false"`` — which is truthy. Reading that as "hosted" would disable
    recording on an ordinary local install with nothing to show the user why.
    """
    if isinstance(value, str):
        return str_to_bool(value)

    return bool(value)


def _server_mode_from_app_context() -> Optional[bool]:
    """``SERVER_MODE`` when called during a request, ``None`` outside one.

    Imported lazily so the module stays importable without Flask and cheap to import
    from ``settings``.
    """
    from flask import current_app, has_app_context

    if not has_app_context():
        return None

    return _as_bool(current_app.config.get("SERVER_MODE", False))


def is_recording_enabled(server_mode: Any = False) -> bool:
    """Whether usage may be written at all.

    The hosted deployment records nothing: a "local file on a managed machine" there
    would be a shared server file mixing many users, including external ones, which
    has a different privacy profile entirely.

    The file half of the off switch exists because an environment variable is
    per-shell, and so easy to set in one terminal and lose in the next.
    """
    if _as_bool(server_mode):
        return False

    if not str_to_bool(os.getenv(USAGE_RECORDING_ENV_VAR, "true")):
        return False

    # Deliberately does not create the directory: a disabled install should leave
    # nothing behind under the user's home.
    return not get_disabled_marker_path().exists()


def get_run_id() -> str:
    """A random identifier for this launch, shared by every process serving it.

    ``main()`` exports this so the gunicorn workers it spawns inherit it, which is
    what lets a session be reconstructed from the log. It is regenerated every launch
    and never persisted — a stable identifier would turn this into per-user tracking.
    """
    global _run_id

    if _run_id is None:
        inherited = os.environ.get(RUN_ID_ENV_VAR, "")
        # An inherited value is attacker-controllable in the same sense any
        # environment variable is; an unchecked one carrying a newline would forge
        # log lines. Fall back rather than write a line that fails validation later.
        _run_id = (
            inherited if _is_safe_value(inherited) else uuid.uuid4().hex[:RUN_ID_LENGTH]
        )

    return _run_id


def get_deployment_mode(tt_metal_home: Optional[str]) -> DeploymentMode:
    """Which population this install belongs to.

    Note this is not the branch ``get_app_data_directory()`` takes: that function
    checks ``$APP_DATA_DIRECTORY`` before container detection, so a container with
    the variable set resolves its data directory from the environment but is still
    reported as a container here. The field describes the environment, not the
    directory. An explicit ``$APP_DATA_DIRECTORY`` on a plain machine is not
    distinguishable as a population and folds into ``local_upload``.
    """
    if tt_metal_home and tt_metal_home.strip():
        return DeploymentMode.TT_METAL_HOME

    if is_running_in_container():
        return DeploymentMode.CONTAINER

    return DeploymentMode.LOCAL_UPLOAD


def get_operating_system() -> OperatingSystem:
    try:
        return OperatingSystem(platform.system().lower())
    except ValueError:
        return OperatingSystem.OTHER


def get_python_version() -> str:
    return f"{sys.version_info.major}.{sys.version_info.minor}"


def get_application_version() -> str:
    """The installed distribution version, falling back to a source checkout."""
    try:
        version = distribution_version(DISTRIBUTION_NAME)
    except PackageNotFoundError:
        try:
            version = read_version_from_package_json()
        except (OSError, KeyError, ValueError):
            return UNKNOWN_VALUE

    # An unparseable version must cost us the field, not the whole event.
    return version if _is_safe_value(version) else UNKNOWN_VALUE


def _is_safe_value(value: str) -> bool:
    return bool(_SAFE_VALUE_PATTERN.match(value))


def _detail_value(value: Any) -> str:
    return value.value if isinstance(value, Enum) else str(value)


def _render_line(fields: List[Tuple[str, str]]) -> str:
    return " ".join(f"{key}={value}" for key, value in fields) + "\n"


def _format_line(event: UsageEvent, details: Dict[str, Any]) -> Optional[str]:
    """A whole logfmt line, or ``None`` if any part of it is unsafe to write."""
    fields = [
        (TIMESTAMP_FIELD, datetime.now(timezone.utc).strftime(TIMESTAMP_FORMAT)),
        (EVENT_FIELD, event.value),
        (SCHEMA_VERSION_FIELD, str(SCHEMA_VERSION)),
        (RUN_ID_FIELD, get_run_id()),
    ]
    fields += [(key, _detail_value(value)) for key, value in details.items()]

    for key, value in fields:
        if not _is_safe_value(key) or not _is_safe_value(value):
            logger.warning(
                "Not recording usage event %s: field %s is not a safe logfmt value",
                event.value,
                key,
            )
            return None

    return _render_line(fields)


def _append_line(line: str) -> None:
    """Append one line, relying on ``O_APPEND`` instead of a lock.

    A single short write to a file opened ``O_APPEND`` is atomic on a local
    filesystem, so any number of instances can share the log with no coordination.
    That guarantee does not hold over NFS, where two simultaneous writers may
    interleave; readers of this file are expected to skip malformed lines.
    """
    get_usage_directory().mkdir(mode=0o700, parents=True, exist_ok=True)

    descriptor = os.open(
        get_usage_log_path(), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600
    )
    try:
        os.write(descriptor, line.encode("utf-8"))
    finally:
        os.close(descriptor)


def record_event(
    event: UsageEvent, server_mode: Optional[Any] = None, **details: Any
) -> None:
    """Append one event, doing nothing at all if recording is disabled.

    ``server_mode`` defaults to whatever the active Flask app says, so callers inside
    a request need not pass it; ``main()`` passes it explicitly because it runs before
    any app exists. The check is repeated here rather than trusted to callers so that
    the writer, not the route, is the thing that enforces it.
    """
    try:
        if server_mode is None:
            server_mode = _server_mode_from_app_context() or False

        if not is_recording_enabled(server_mode):
            return

        line = _format_line(event, details)
        if line is None:
            return

        _append_line(line)
    except OSError as error:
        # Instrumentation must never break the application it measures.
        logger.warning("Unable to record usage event %s: %s", event.value, error)


def record_app_start(config: Any, server_mode: Optional[Any] = None) -> None:
    record_event(
        UsageEvent.APP_START,
        server_mode=server_mode,
        version=get_application_version(),
        deployment_mode=get_deployment_mode(getattr(config, "TT_METAL_HOME", None)),
        os=get_operating_system(),
        python_version=get_python_version(),
    )


def _parse_line(line: str) -> Optional[Dict[str, str]]:
    """Split a logfmt line into fields, or ``None`` if it is not one."""
    fields: Dict[str, str] = {}

    for token in line.split(" "):
        if not token:
            continue

        key, separator, value = token.partition("=")
        if not separator or not key:
            return None

        fields[key] = value

    return fields or None


def _summarise(lines: List[str]) -> List[str]:
    """Replace a span of lines with one counted summary line per field combination.

    Totals are preserved exactly, which is the whole point: a collector derives
    cumulative counters from this file, and deleting lines instead would make those
    counters go down. Prometheus reads a decrease as a counter reset and extrapolates
    the recovery, so trimming naively both loses history and invents activity.

    ``schema_version`` is part of the key, so a format change never merges two
    versions of a renamed field into one bucket. ``run_id`` is not, so session shape
    is unreconstructable for a compacted span — keeping it would produce a summary
    line per run and defeat compaction entirely.
    """
    totals: Dict[Tuple[Tuple[str, str], ...], int] = {}
    latest_timestamps: Dict[Tuple[Tuple[str, str], ...], str] = {}
    unparsed: List[str] = []

    for line in lines:
        fields = _parse_line(line)
        if fields is None:
            unparsed.append(line)
            continue

        try:
            count = int(fields.get(COUNT_FIELD, "1"))
        except ValueError:
            unparsed.append(line)
            continue

        timestamp = fields.get(TIMESTAMP_FIELD, "")
        key = tuple(
            sorted(
                (name, value)
                for name, value in fields.items()
                if name not in _UNSUMMARISABLE_FIELDS
            )
        )

        totals[key] = totals.get(key, 0) + count
        latest_timestamps[key] = max(latest_timestamps.get(key, ""), timestamp)

    summaries = []
    for key, count in totals.items():
        remaining = dict(key)
        # Keep the leading `ts=` and `event=` shape of an ordinary line so a reader
        # needs no special case for summaries beyond honouring `count`.
        summary_fields = [
            (TIMESTAMP_FIELD, latest_timestamps[key]),
            (EVENT_FIELD, remaining.pop(EVENT_FIELD, UNKNOWN_VALUE)),
        ]
        summary_fields += sorted(remaining.items())
        summary_fields.append((COUNT_FIELD, str(count)))
        summaries.append(_render_line(summary_fields).rstrip("\n"))

    # Lines we could not parse are kept verbatim rather than dropped, so a garbled
    # line costs its own event at worst and never the totals around it.
    return sorted(summaries) + unparsed


def compact_if_needed() -> None:
    """Halve the log by summarising its older half, once it exceeds the cap.

    Called at launch only, so it never runs on a request path. If another instance is
    already compacting we skip rather than wait — the log will simply be compacted at
    some later launch.
    """
    try:
        import fcntl
    except ImportError:
        # Windows. `main()` cannot run there anyway (gunicorn is POSIX-only), so this
        # only keeps the module importable rather than promising compaction.
        logger.debug("Skipping usage log compaction: file locking is unavailable")
        return

    log_path = get_usage_log_path()

    try:
        if not log_path.exists() or log_path.stat().st_size <= MAX_LOG_BYTES:
            return

        with open(
            get_usage_directory() / COMPACTION_LOCK_NAME, "w", encoding="utf-8"
        ) as lock_file:
            try:
                fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                return

            try:
                _compact(log_path)
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
    except OSError as error:
        logger.warning("Unable to compact the usage log: %s", error)


def _compact(log_path: Path) -> None:
    lines = log_path.read_text(encoding="utf-8").splitlines()
    split_at = len(lines) // 2
    if not split_at:
        return

    compacted = _summarise(lines[:split_at]) + lines[split_at:]

    # An append landing between the read above and the replace below goes to the old
    # inode and is lost. The window is a few milliseconds once a year, which is a
    # better trade than taking a lock on every append.
    temporary_path = log_path.with_name(f"{log_path.name}.compacting")
    temporary_path.write_text("\n".join(compacted) + "\n", encoding="utf-8")
    os.replace(temporary_path, log_path)
