# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Append-only event logs.

Local installs append to one fixed file under the user's home directory. Hosted
installs append to a separate file per anonymous Flask session under ``/data/usage``.
The identifier stays in the path rather than entering event data. The application
backend forwards nothing; an out-of-band collector may later read the files.

Properties this file's consumers depend on, stated here because they are not
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
* **Only ``*.log`` files are event data.** Compaction leaves a ``.compaction.lock``
  beside the log; globbing the directory for anything else will pick it up.
* **Local compaction does not preserve line order across the summarised span.**
  Unparseable lines kept verbatim are appended after the sorted summaries, so
  they can land out of time order relative to events they sat between.
* **``ts`` is when the event was written, not when it happened.** Events posted by
  the frontend arrive in batches, and the server stamps them on receipt rather than
  trusting a client clock, so one batch carries one timestamp and every event in it
  is late by up to the client's flush interval. Fine for the day- and week-
  granularity questions this file exists to answer; not a source for anything
  needing sub-minute ordering.
* **The log stops growing shortly past ``MAX_LOG_BYTES``.** Appends are refused once it
  is over the cap, rather than trimmed, because trimming is what makes cumulative totals
  go down. The check is amortised, so the overshoot is bounded by
  ``LOG_SIZE_CHECK_INTERVAL_BYTES`` plus one batch rather than being exact — and the
  counter behind it is per-process, so a multi-worker deployment multiplies that
  overshoot by its worker count. Treat the cap as approximate. Local compaction at the
  next launch summarises the older half and appends resume; hosted retention and
  compaction belong to the deployment collector.

Every recorded value comes from a closed enum, a bucketed value, or the
application's own version. No report, file, directory, operation or host names,
and no free-form text, may ever be written here.
"""

import json
import logging
import os
import platform
import re
import sys
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from importlib.metadata import PackageNotFoundError, distribution
from importlib.metadata import version as distribution_version
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Type

from ttnn_visualizer.utils import (
    FALSE_VALUES,
    TRUE_VALUES,
    is_flag_enabled,
    is_running_in_container,
    parse_bool,
    read_version_from_package_json,
)

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1

# Deliberately not get_app_data_directory(): two of its four branches are derived
# from the environment (TT_METAL_HOME, $APP_DATA_DIRECTORY), and a collector running
# as root has no access to the user's shell environment, so it could only find those
# by crawling home directories. This path is an interface to another team — narrow,
# fixed and documented — while the app data directory is an implementation detail
# that has already moved once.
#
# Override for tests. Production resolves via :func:`get_event_log_root` on each
# call so ``Path.home()`` is not on the import path of ``settings`` (it raises
# ``RuntimeError`` when ``HOME`` is unset and the uid is absent from passwd). The
# override replaces both posture roots so tests cannot touch ``/data`` either.
EVENT_LOG_DIRECTORY: Optional[Path] = None
HOSTED_EVENT_LOG_ROOT = Path("/data/usage")
EVENT_LOG_FILENAME = "events.log"
DISABLED_MARKER_NAME = "disabled"
COMPACTION_LOCK_NAME = ".compaction.lock"
EVENT_LOG_ID_SESSION_KEY = "event_log_id"
EVENT_LOG_ID_LENGTH = 32

# Recording is on by default, so the variable is an opt-out rather than a switch: an
# operator who wants no event-log data sets this, and everyone else sets nothing.
RECORDING_DISABLED_ENV_VAR = "USAGE_RECORDING_DISABLED"

RUN_ID_ENV_VAR = "TTNN_VISUALIZER_RUN_ID"

# The cap is a privacy control as much as a disk one. View and engagement events are
# per-navigation rather than per-launch, so a heavy user's log grows an order of magnitude
# faster than the ~27 KB/day a launch-only log manages (~110 bytes a line, ~250 a day).
# That is what puts the cap on the write path rather than leaving it to the next launch:
# within one long session there is enough traffic to reach it.
MAX_LOG_BYTES = 10 * 1024 * 1024

# How much may be appended between two size checks. Growth is client-driven, so the write
# path enforces the cap, but stat'ing per batch would put a syscall on every flush:
# amortise instead, at ~2,400 events between checks. Once a check finds the log over the
# cap that verdict is cached rather than re-derived (see :func:`_is_log_full`), so the
# overshoot is this interval plus one batch — not this interval per refused batch.
LOG_SIZE_CHECK_INTERVAL_BYTES = 256 * 1024

# The largest batch one request may carry, which is also the largest number of lines one
# ``os.write`` has to hold. It lives here rather than beside the ingest route's byte cap
# because what it bounds is ``_append_line``'s atomicity, not merely an HTTP body, and is
# enforced in ``_write_events`` so a second batch caller cannot bypass it: raising it in
# ``views.py`` alone would silently relax a guarantee documented here.
MAX_EVENT_LOG_BATCH_EVENTS = 50
MAX_HOSTED_EVENT_LOGS = 1024
MAX_HOSTED_BATCHES_PER_MINUTE = 120
MAX_HOSTED_EVENT_LOG_CREATIONS_PER_MINUTE = 60
HOSTED_RATE_WINDOW_SECONDS = 60.0
HOSTED_FULL_LOG_RECHECK_SECONDS = 60.0
HOSTED_QUOTA_LOCK_NAME = ".quota.lock"
HOSTED_CREATION_RATE_NAME = ".creation-rate"

# Only has to be unique within one machine's log for one sitting, and is never
# exported, so a full 32-character UUID would be 24 wasted bytes on every line.
RUN_ID_LENGTH = 8

TIMESTAMP_FIELD = "ts"
EVENT_FIELD = "event"
SCHEMA_VERSION_FIELD = "schema_version"
RUN_ID_FIELD = "run_id"
COUNT_FIELD = "count"

# Detail field names. Constants for the same reason the fields above are: they cross
# both the HTTP boundary and the log format, and the frontend will re-enumerate them.
KIND_FIELD = "kind"
SOURCE_FIELD = "source"
REASON_CLASS_FIELD = "reason_class"
VIEW_FIELD = "view"

# The wire shape of one posted event. ``EVENT_FIELD`` doubles as its name on the wire and
# so is not restated; ``DETAILS_FIELD`` has no log equivalent, since details are flattened
# into the line rather than nested inside it.
DETAILS_FIELD = "details"
_CLIENT_EVENT_KEYS = frozenset({EVENT_FIELD, DETAILS_FIELD})

# UTC, fixed width. `datetime.isoformat()` would give microseconds and `+00:00`
# rather than `Z`, which is neither fixed width nor the form the collector parses.
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

DISTRIBUTION_NAME = "ttnn_visualizer"
UNKNOWN_VALUE = "unknown"

# logfmt values are unquoted, so a value carrying a space, an `=` or a newline could
# forge extra fields or whole extra events. Enum members, versions and timestamps all
# fit inside this set; anything that doesn't is a bug rather than a value to escape.
_SAFE_VALUE_PATTERN = re.compile(r"^[A-Za-z0-9._:+-]+$")
_EVENT_LOG_ID_PATTERN = re.compile(rf"^[0-9a-f]{{{EVENT_LOG_ID_LENGTH}}}$")

# Fields that identify a single line rather than a class of them, and so cannot
# survive being summarised into a count.
_UNSUMMARISABLE_FIELDS = (TIMESTAMP_FIELD, RUN_ID_FIELD, COUNT_FIELD)

# Every line this module writes carries these, and so does every summary line, so a
# line without them is an interleaved fragment rather than an event.
_REQUIRED_FIELDS = (TIMESTAMP_FIELD, EVENT_FIELD, SCHEMA_VERSION_FIELD)

_run_id: Optional[str] = None


@dataclass
class _EventLogState:
    """Amortised state belonging to one local or hosted event log."""

    bytes_since_size_check: int = LOG_SIZE_CHECK_INTERVAL_BYTES
    directory_ensured: bool = False
    log_full: bool = False
    write_failure_logged: bool = False
    next_full_check_at: float = 0.0
    rate_window_started_at: float = 0.0
    batches_in_rate_window: int = 0
    reservation_checked: bool = False


# Keep every admitted log's rate state while bounding process memory; tying this to the
# file quota prevents cache churn from resetting a client's rate window.
MAX_TRACKED_EVENT_LOGS = MAX_HOSTED_EVENT_LOGS
_local_log_state = _EventLogState()
_hosted_log_state_by_path: "OrderedDict[Path, _EventLogState]" = OrderedDict()
_hosted_quota_warning_logged = False


class EventLogEvent(str, Enum):
    APP_START = "app_start"
    REPORT_LOADED = "report_loaded"
    REPORT_LOAD_FAILED = "report_load_failed"
    VIEW_OPENED = "view_opened"
    VIEW_ENGAGED = "view_engaged"


class DeploymentMode(str, Enum):
    TT_METAL_HOME = "tt_metal_home"
    CONTAINER = "container"
    LOCAL_UPLOAD = "local_upload"


class LaunchMode(str, Enum):
    SOURCE = "source"
    WHEEL = "wheel"
    HOSTED = "hosted"


class OperatingSystem(str, Enum):
    DARWIN = "darwin"
    LINUX = "linux"
    WINDOWS = "windows"
    OTHER = "other"


class ReportKind(str, Enum):
    PROFILER = "profiler"
    PERFORMANCE = "performance"
    NPE = "npe"
    MLIR = "mlir"
    CLUSTER_DESCRIPTOR = "cluster_descriptor"


class ReportSource(str, Enum):
    UPLOAD = "upload"
    REMOTE_SYNC = "remote_sync"
    LOCAL_TT_METAL = "local_tt_metal"
    DEMO = "demo"


class ReportLoadFailureReason(str, Enum):
    """Why a report failed to load, coarsely enough to never carry a message body.

    ``unsupported_version`` is NPE-only today. NPE refuses an out-of-range format
    version and never shows the report. Profiler and performance reports still
    activate on an incompatible DB major version: they toast a warning and count
    as ``report_loaded``, because the UI continues to show them.
    """

    UNSUPPORTED_VERSION = "unsupported_version"
    MISSING_FILE = "missing_file"
    PARSE_ERROR = "parse_error"
    TOO_LARGE = "too_large"
    PERMISSION = "permission"
    OTHER = "other"


class EventLogView(str, Enum):
    """The navigable surfaces worth counting: the ten proposed in #1819.

    ``TOPOLOGY`` is a **modal route**, and that is a trap worth stating rather than
    rediscovering. ``ROUTES.CLUSTER`` carries ``element: null`` in
    ``routeObjectList.tsx`` *because* ``Layout`` renders ``ClusterRenderer`` itself as an
    overlay over the background route, keyed on ``location.state.background``; the nav
    button navigates with that state and Escape closes it with ``navigate(-1)``. So the
    surface is fully implemented, and a route-to-view mapping derived from the route
    *elements* would silently drop it — derive from ``ROUTES``, which does contain
    ``CLUSTER``.

    Two consequences for reading its counts. It is the only view reachable solely by
    clicking a nav button, which makes every navigation to it a deliberate act rather
    than something a redirect can produce. And its button is disabled unless the active
    report carries cluster data, so it must be read against *reports containing a cluster
    descriptor* — a narrower denominator than "a profiler report is loaded", which is the
    ratio caveat 6 asks for everywhere else.

    ``styleguide`` is excluded and stays excluded: a development surface, so counting it
    would pollute reach.

    ``REPORTS`` is the index route ``/`` rather than a named route, and ``GRAPH``
    and ``BUFFERS`` deliberately differ in name from their paths (``/graphtree``,
    ``/buffer-summary``) because the enum names the surface, not the URL.

    ``OPERATION_DETAILS`` is a real route and is owned by ``view_opened``. A future
    ``drilldown_opened`` event must exclude it, or one navigation would be counted
    as two different actions. It counts once per operation viewed rather than once
    per visit to the surface, so its total is not comparable to the other nine and
    should be read per-session or deduplicated.
    """

    REPORTS = "reports"
    OPERATIONS = "operations"
    OPERATION_DETAILS = "operation_details"
    TENSORS = "tensors"
    BUFFERS = "buffers"
    GRAPH = "graph"
    PERFORMANCE = "performance"
    NPE = "npe"
    MLIR = "mlir"
    TOPOLOGY = "topology"


# Where every detail value a client may post has to come from. `_SAFE_VALUE_PATTERN`
# is not enough on its own: it would happily accept `kind=totally-made-up`, and the
# bounded contents of this file are the entire promise being made.
_DETAIL_FIELD_ENUMS: Mapping[str, Type[Enum]] = {
    KIND_FIELD: ReportKind,
    SOURCE_FIELD: ReportSource,
    REASON_CLASS_FIELD: ReportLoadFailureReason,
    VIEW_FIELD: EventLogView,
}

# What a client may post, and the exact detail fields each event carries. Exported so
# the frontend enums and the docs page can be derived from one source rather than
# transcribed — a silent divergence there means events the client emits and the server
# rejects, which the client is designed not to notice.
#
# `APP_START` is deliberately absent: the server records launches itself, and a client
# able to post one could forge the deployment population every other figure is read
# against.
CLIENT_EVENT_DETAIL_FIELDS: Mapping[EventLogEvent, Tuple[str, ...]] = {
    EventLogEvent.REPORT_LOADED: (KIND_FIELD, SOURCE_FIELD),
    EventLogEvent.REPORT_LOAD_FAILED: (KIND_FIELD, REASON_CLASS_FIELD),
    EventLogEvent.VIEW_OPENED: (VIEW_FIELD,),
    EventLogEvent.VIEW_ENGAGED: (VIEW_FIELD,),
}


class EventLogEventRejected(Exception):
    """A posted event failed the schema above.

    Lives here rather than in ``exceptions.py`` because it carries no HTTP status and
    describes the log's schema, not a transport failure — the route decides what a
    rejection means over HTTP.

    The message must describe what was *expected*, never echo what arrived. A response
    body is one of the few ways client-supplied free-form text could re-enter a system
    whose whole point is that it holds none.
    """


def get_event_log_root(server_mode: Any = False) -> Path:
    """The fixed root for the selected deployment posture."""
    if EVENT_LOG_DIRECTORY is not None:
        return EVENT_LOG_DIRECTORY

    if is_flag_enabled(server_mode):
        return HOSTED_EVENT_LOG_ROOT

    return Path.home() / ".ttnn-visualizer" / "usage"


def _is_valid_event_log_id(value: Any) -> bool:
    return isinstance(value, str) and bool(_EVENT_LOG_ID_PATTERN.fullmatch(value))


def ensure_event_log_id() -> str:
    """Return the server-minted anonymous log identifier in the Flask session."""
    from flask import session

    event_log_id = session.get(EVENT_LOG_ID_SESSION_KEY)
    if not _is_valid_event_log_id(event_log_id):
        event_log_id = uuid.uuid4().hex
        session[EVENT_LOG_ID_SESSION_KEY] = event_log_id

    return event_log_id


def get_event_log_directory(
    server_mode: Any = False, event_log_id: Optional[str] = None
) -> Path:
    """The event directory for a local install or one hosted browser session."""
    root = get_event_log_root(server_mode)
    if not is_flag_enabled(server_mode):
        return root

    if not _is_valid_event_log_id(event_log_id):
        raise ValueError("Hosted event logging requires a valid event log identifier")
    assert event_log_id is not None

    resolved_root = root.resolve()
    resolved_directory = (root / event_log_id).resolve()
    try:
        resolved_directory.relative_to(resolved_root)
    except ValueError:
        raise ValueError(
            "Hosted event-log directory escaped its configured root"
        ) from None

    return resolved_directory


def get_event_log_path(
    server_mode: Any = False, event_log_id: Optional[str] = None
) -> Path:
    return get_event_log_directory(server_mode, event_log_id) / EVENT_LOG_FILENAME


def get_disabled_marker_path(server_mode: Any = False) -> Path:
    return get_event_log_root(server_mode) / DISABLED_MARKER_NAME


def _nameable_marker_path(server_mode: Any = False) -> Optional[Path]:
    """The marker path when it can be resolved, ``None`` when it cannot.

    ``get_disabled_marker_path`` resolves ``Path.home()``, which raises ``RuntimeError``
    when ``HOME`` is unset and the uid is absent from passwd — the arbitrary-uid
    container pattern the note beside ``EVENT_LOG_DIRECTORY`` describes. The two sentences
    below are *advice*, so a path they cannot name is a clause to drop rather than a
    reason to raise: the settings override loop builds one while ``Config()`` is being
    constructed, and an exception there stops the app over a variable that configures
    nothing (#1937 review). Dropping the clause is also the truthful thing to say —
    without a resolvable home there is no directory for the marker to live in, so the
    environment variable really is the only control left.
    """
    try:
        return get_disabled_marker_path(server_mode)
    except RuntimeError:
        return None


def describe_opt_out(server_mode: Any = False) -> str:
    """The sentence telling an operator how to switch recording off.

    One function because two places say it — the launch banner and the retired-variable
    warning — from the same two ingredients, and they have to agree. The rename that
    introduced this helper had to edit both in lockstep, which is the drift it prevents.
    """
    marker = _nameable_marker_path(server_mode)
    if marker is None:
        return f"Switch it off with {RECORDING_DISABLED_ENV_VAR}=true."

    return (
        f"Switch it off with {RECORDING_DISABLED_ENV_VAR}=true or by creating {marker}."
    )


def describe_opt_in(server_mode: Any = False) -> str:
    """The sentence for an operator who wants recording on and hasn't got it.

    The inverse of :func:`describe_opt_out`, and here for the same reason: the marker
    path and the variable are written once, so the two directions can't drift into
    naming different controls.

    Asserts only the default and names both opt-out controls for the selected posture.
    """
    marker = _nameable_marker_path(server_mode)
    if marker is None:
        remedy = f"{RECORDING_DISABLED_ENV_VAR}=false clears the opt-out"
    else:
        remedy = (
            f"{RECORDING_DISABLED_ENV_VAR}=false and removing {marker} "
            "clear the two opt-outs"
        )

    return f"Recording is on by default. {remedy}."


def _server_mode_from_app_context() -> Optional[bool]:
    """``SERVER_MODE`` when called during a request, ``None`` outside one.

    Imported lazily so the module stays importable without Flask and cheap to import
    from ``settings``.
    """
    from flask import current_app, has_app_context

    if not has_app_context():
        return None

    return is_flag_enabled(current_app.config.get("SERVER_MODE", False))


def _is_recording_disabled_by_environment() -> bool:
    """Whether the operator's environment asks us not to record.

    This variable is an opt-out: unset, ``false`` and ``0`` keep recording on;
    ``true`` and ``1`` switch it off. An unrecognised value also switches recording
    off, so a misspelling such as ``USAGE_RECORDING_DISABLED=yes`` cannot accidentally
    be read as consent to record; the top-level launcher reports that decision beside
    its recording status.

    Other boolean settings discard an unrecognised value and keep their declared
    default. The different treatment here is deliberate because the safe consequence
    is one missing data point, while ignoring a misspelled opt-out records against the
    operator's apparent intent.
    """
    value = os.getenv(RECORDING_DISABLED_ENV_VAR)
    if value is None:
        return False

    parsed = parse_bool(value)
    return parsed is not False


def get_unrecognised_recording_disabled_value() -> Optional[str]:
    """Return the invalid opt-out value the launcher should report, if any."""
    value = os.getenv(RECORDING_DISABLED_ENV_VAR)
    if value is None or parse_bool(value) is not None:
        return None

    return value


def describe_unrecognised_recording_disabled_value(value: str) -> str:
    """Explain an invalid opt-out using the canonical boolean vocabulary."""

    def _words_before_digits(values: Iterable[str]) -> str:
        return "/".join(sorted(values, key=lambda token: token.isdigit()))

    disabled_values = _words_before_digits(TRUE_VALUES)
    enabled_values = _words_before_digits(FALSE_VALUES)
    return (
        f"{RECORDING_DISABLED_ENV_VAR}={value!r} is not a recognised boolean. "
        "Because this variable is an opt-out, event logging will be disabled; "
        f"use {disabled_values} to disable or {enabled_values} to keep it enabled."
    )


def get_recording_disabled_reason(server_mode: Any = False) -> Optional[str]:
    """Why event logging is disabled, or ``None`` when it is enabled."""
    if _is_recording_disabled_by_environment():
        return f"{RECORDING_DISABLED_ENV_VAR} requests the opt-out"

    marker = get_disabled_marker_path(server_mode)
    if marker.exists():
        return f"the marker file exists at {marker}"

    return None


def is_recording_enabled(server_mode: Any = False) -> bool:
    """Whether events may be written at all.

    Recording is on by default, and ``USAGE_RECORDING_DISABLED`` is the opt-out.

    Hosted events are separated into server-derived session directories rather than
    mixed into one shared file.

    The file half of the off switch exists because an environment variable is
    per-shell, and so easy to set in one terminal and lose in the next.
    """
    # Deliberately does not create the directory: a disabled install should leave
    # nothing behind under the user's home.
    return get_recording_disabled_reason(server_mode) is None


def get_run_id() -> str:
    """A random identifier for this launch, shared by every process serving it.

    ``main()`` calls :func:`start_run` and exports the result so the gunicorn workers
    it spawns inherit it, which is what lets a session be reconstructed from the log.
    The fallback generation here supports direct module use outside that launcher.
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


def start_run() -> str:
    """Create the fresh identifier that the top-level launcher shares with workers."""
    global _run_id

    # Never trust an inherited value in the launcher: a shell-level override would
    # otherwise turn the per-launch identifier into a persistent tracking key. Workers
    # do not call this function; they inherit the value exported after this returns.
    _run_id = uuid.uuid4().hex[:RUN_ID_LENGTH]
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


def get_launch_mode(server_mode: Any = False) -> LaunchMode:
    """How this process was launched, without exposing an installation path."""
    if is_flag_enabled(server_mode):
        return LaunchMode.HOSTED

    try:
        direct_url = distribution(DISTRIBUTION_NAME).read_text("direct_url.json")
        if direct_url and json.loads(direct_url).get("dir_info", {}).get("editable"):
            return LaunchMode.SOURCE
    except (PackageNotFoundError, OSError, ValueError):
        # A direct source invocation has no distribution metadata.
        return LaunchMode.SOURCE

    return LaunchMode.WHEEL


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


def _get_timestamp() -> str:
    return datetime.now(timezone.utc).strftime(TIMESTAMP_FORMAT)


def _format_line(
    event: EventLogEvent, details: Dict[str, Any], timestamp: str
) -> Optional[str]:
    """A whole logfmt line, or ``None`` if any part of it is unsafe to write.

    ``timestamp`` is passed in rather than read here so every line in one batch carries
    the same one — ``TIMESTAMP_FORMAT`` is second-granular, so a batch straddling a
    second boundary would otherwise split across two, and the module docstring promises
    a collector it will not.
    """
    fields = [
        (TIMESTAMP_FIELD, timestamp),
        (EVENT_FIELD, event.value),
        (SCHEMA_VERSION_FIELD, str(SCHEMA_VERSION)),
        (RUN_ID_FIELD, get_run_id()),
    ]
    fields += [(key, _detail_value(value)) for key, value in details.items()]

    for key, value in fields:
        if not _is_safe_value(key) or not _is_safe_value(value):
            logger.warning(
                "Not recording event %s: field %s is not a safe logfmt value",
                event.value,
                key,
            )
            return None

    return _render_line(fields)


def _ensure_hosted_log_state(log_path: Path) -> _EventLogState:
    """Return bounded per-path state, refreshing its LRU position."""
    state = _hosted_log_state_by_path.pop(log_path, None)
    if state is None:
        state = _EventLogState()

    _hosted_log_state_by_path[log_path] = state
    while len(_hosted_log_state_by_path) > MAX_TRACKED_EVENT_LOGS:
        _hosted_log_state_by_path.popitem(last=False)

    return state


def _state_for_log(log_path: Path, hosted: bool) -> _EventLogState:
    return _ensure_hosted_log_state(log_path) if hosted else _local_log_state


def _is_hosted_rate_limited(state: _EventLogState) -> bool:
    now = time.monotonic()
    if (
        state.rate_window_started_at == 0.0
        or now - state.rate_window_started_at >= HOSTED_RATE_WINDOW_SECONDS
    ):
        state.rate_window_started_at = now
        state.batches_in_rate_window = 0

    if state.batches_in_rate_window >= MAX_HOSTED_BATCHES_PER_MINUTE:
        return True

    state.batches_in_rate_window += 1
    return False


def _reserve_hosted_log(log_path: Path, state: _EventLogState) -> bool:
    """Atomically reserve one bounded hosted log slot across server workers."""
    global _hosted_quota_warning_logged

    if state.reservation_checked:
        return True

    if log_path.exists():
        state.reservation_checked = True
        return True

    try:
        import fcntl
    except ImportError:
        logger.warning("Hosted event logging requires POSIX file locking")
        return False

    root = log_path.parent.parent
    try:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        lock_path = root / HOSTED_QUOTA_LOCK_NAME
        with open(lock_path, "a+", encoding="utf-8") as lock_file:
            os.chmod(lock_path, 0o600)
            fcntl.flock(lock_file, fcntl.LOCK_EX)
            try:
                if log_path.exists():
                    state.reservation_checked = True
                    return True

                event_log_count = sum(
                    1
                    for entry in root.iterdir()
                    if entry.is_dir()
                    and _is_valid_event_log_id(entry.name)
                    and (entry / EVENT_LOG_FILENAME).is_file()
                )
                if event_log_count >= MAX_HOSTED_EVENT_LOGS:
                    if not _hosted_quota_warning_logged:
                        logger.warning(
                            "Hosted event log quota of %d files has been reached",
                            MAX_HOSTED_EVENT_LOGS,
                        )
                        _hosted_quota_warning_logged = True
                    return False

                creation_rate_path = root / HOSTED_CREATION_RATE_NAME
                now = time.time()
                try:
                    window_text, count_text = creation_rate_path.read_text(
                        encoding="utf-8"
                    ).split()
                    window_started_at = float(window_text)
                    creation_count = int(count_text)
                except (OSError, ValueError):
                    window_started_at = now
                    creation_count = 0

                if now - window_started_at >= HOSTED_RATE_WINDOW_SECONDS:
                    window_started_at = now
                    creation_count = 0
                if creation_count >= MAX_HOSTED_EVENT_LOG_CREATIONS_PER_MINUTE:
                    return False

                creation_rate_path.write_text(
                    f"{window_started_at} {creation_count + 1}\n",
                    encoding="utf-8",
                )
                os.chmod(creation_rate_path, 0o600)
                log_path.parent.mkdir(mode=0o700, parents=False, exist_ok=True)
                descriptor = os.open(
                    log_path,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
                os.close(descriptor)
                _hosted_quota_warning_logged = False
                state.reservation_checked = True
                return True
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
    except FileExistsError:
        state.reservation_checked = log_path.exists()
        return state.reservation_checked
    except OSError:
        raise


def _open_log(log_path: Path) -> int:
    return os.open(
        log_path,
        os.O_WRONLY | os.O_APPEND | os.O_CREAT,
        0o600,
    )


def _ensure_directory(
    directory: Path,
    state: _EventLogState,
    force: bool = False,
) -> None:
    """Create the event-log directory unless this process is known to have done so already.

    Cached because ``mkdir`` — plus its caught ``FileExistsError`` and stat — would
    otherwise run on every request. ``force`` re-creates it after an append has found it
    missing, which is the only way the cache can be wrong in a way retrying fixes.
    """
    if force or not state.directory_ensured:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        state.directory_ensured = True


def _append_line(
    line: str, log_path: Path, state: _EventLogState, hosted: bool = False
) -> None:
    """Append one write, relying on ``O_APPEND`` instead of a lock.

    A single short write to a file opened ``O_APPEND`` is atomic on a local
    filesystem, so any number of instances can share the log with no coordination.
    That guarantee does not hold over NFS, where two simultaneous writers may
    interleave; readers of this file are expected to skip malformed lines.

    The argument may hold several newline-terminated lines, which is how a batch stays
    one write rather than N interleavable ones. Keeping it short enough to go out in a
    single ``os.write`` is the caller's job — that is what ``MAX_EVENT_LOG_BATCH_EVENTS``
    bounds — since the short-write loop below forfeits the guarantee if it has to
    iterate.
    """
    directory = log_path.parent
    _ensure_directory(directory, state)

    try:
        descriptor = _open_log(log_path)
    except FileNotFoundError:
        # The directory has gone since it was cached, which the docs actively invite by
        # offering a delete command. Recreate it and retry rather than losing this batch
        # and every batch after it to a condition one ``mkdir`` fixes.
        state.reservation_checked = False
        if hosted:
            if not _reserve_hosted_log(log_path, state):
                raise OSError("hosted event log quota or creation rate reached")
        else:
            _ensure_directory(directory, state, force=True)
        descriptor = _open_log(log_path)
    except OSError:
        # A revoked permission or a full disk may equally be fixed before the next
        # append, so stop claiming the directory is known-good.
        state.directory_ensured = False
        raise

    try:
        # ``os.write`` can return a short count without raising (e.g. a full disk).
        # Leaving a partial line would look identical to an NFS interleave.
        encoded = line.encode("utf-8")
        offset = 0
        while offset < len(encoded):
            written = os.write(descriptor, encoded[offset:])
            if written == 0:
                raise OSError("event log write returned 0 bytes")
            offset += written

        state.bytes_since_size_check += offset
        # Writes are landing again, so the next failure for this log is worth a warning.
        state.write_failure_logged = False
    finally:
        os.close(descriptor)


def _is_log_full(log_path: Path, state: _EventLogState, hosted: bool = False) -> bool:
    """Whether the log has reached its cap, re-measured at most once per interval.

    Refusing appends is the only correct answer at the cap. Trimming here is what makes
    cumulative totals go down, which Prometheus reads as a counter reset and then
    extrapolates — losing history and inventing activity at once. Compacting here is no
    better: ``_compact`` reads the whole file, and this runs on a request path.
    Local compaction at the next launch summarises the older half and appends resume;
    hosted logs are re-checked after external compaction.

    Between measurements the previous verdict is returned rather than recomputed, and that
    is load-bearing rather than an optimisation. The state's byte counter counts bytes
    *appended*, so a refused batch cannot advance it: answering "not full" while the
    counter sits below the interval would give every batch after a refusal a free
    interval, and the log would grow by one interval per refusal for as long as a client
    kept posting — a cap that drops one batch in every few thousand rather than one that
    holds. Only :func:`_invalidate_size_check` clears the verdict.

    Strictly greater than, matching ``compact_if_needed``'s own threshold, and the two have
    to agree: with ``>=`` here a log sitting exactly on the cap would refuse every append
    while compaction still skipped it as not-yet-over, leaving it stuck. The boundary is
    not where the precision is lost anyway — the interval check above means the log can
    already be up to ``LOG_SIZE_CHECK_INTERVAL_BYTES`` over before this runs at all.
    """
    now = time.monotonic()
    if state.log_full:
        if not hosted or now < state.next_full_check_at:
            return True
    elif state.bytes_since_size_check < LOG_SIZE_CHECK_INTERVAL_BYTES:
        return False

    was_full = state.log_full

    try:
        state.log_full = log_path.stat().st_size > MAX_LOG_BYTES
    except OSError:
        # No log yet, or it is unreadable. Either way not full; a real write failure is
        # the append's problem to report, not this check's.
        state.log_full = False

    state.bytes_since_size_check = 0
    state.next_full_check_at = (
        now + HOSTED_FULL_LOG_RECHECK_SECONDS if hosted and state.log_full else 0.0
    )

    if state.log_full and not was_full:
        # Once, on the way in. Everything after this point is dropped and answered 204,
        # so without a line here a machine whose recording has stopped is indistinguishable
        # from a user who stopped using the application — the same misreading the refusal
        # itself exists to prevent.
        logger.warning(
            "Event log has reached its %d byte cap; no further events will be recorded "
            "until it is compacted or removed",
            MAX_LOG_BYTES,
        )

    return state.log_full


def _invalidate_size_check(state: Optional[_EventLogState] = None) -> None:
    """Force the next append to measure the log again.

    Called after compaction, which is the only thing that gives a full log room. It does
    not simply declare the log not-full because compaction does not promise to get under
    the cap — it skips the rewrite when the older half holds nothing summarisable — so the
    next append pays one stat and finds out for itself.
    """
    state = state or _local_log_state
    state.log_full = False
    state.bytes_since_size_check = LOG_SIZE_CHECK_INTERVAL_BYTES
    state.next_full_check_at = 0.0


def _warn_write_failure(state: _EventLogState, message: str, *args: Any) -> None:
    """Report the first failure of a run of them, then stay quiet until a write lands.

    A persistent failure — a full disk, a revoked permission, a deleted directory — would
    otherwise produce one warning per flush on a route called often by design, so an
    instrumentation subsystem that must not disturb the application it measures would end
    up flooding that application's log instead. Repeats go to debug; ``_append_line``
    clears the latch as soon as a write succeeds, so a genuinely new failure is still
    reported.
    """
    if state.write_failure_logged:
        logger.debug(message, *args)
        return

    state.write_failure_logged = True
    logger.warning(message, *args)


def _resolve_server_mode(server_mode: Optional[Any]) -> Any:
    """``server_mode`` as given, or whatever the active Flask app says.

    Shared so the ``or False`` fallback cannot be corrected at two of its three call
    sites: callers inside a request need not pass it, while ``main()`` passes it
    explicitly because it runs before any app exists.
    """
    if server_mode is not None:
        return server_mode

    return _server_mode_from_app_context() or False


def _write_events(
    events: Sequence[Tuple[EventLogEvent, Mapping[str, Any]]],
    server_mode: Any,
    event_log_id: Optional[str] = None,
) -> bool:
    """The whole write path, all of it or none of it, in a single append.

    All-or-nothing because a reader cannot tell a partial batch from a complete one, and
    a file whose bounded contents are the entire promise must not hold half an event.
    Formatting every line before writing any is what buys that — except under a short
    write that then fails, which leaves a partial line indistinguishable from an NFS
    interleave and is quarantined by ``_summarise`` (see :func:`_append_line`).

    Shared by both public recorders so the guard order and the failure semantics have one
    definition; each caller keeps only its own warning wording, which is the part that
    legitimately differs.
    """
    # Once per batch, not per event: the first stats the disabled marker, the second the
    # log itself.
    if not is_recording_enabled(server_mode):
        return False

    # Here rather than only at the route, so ``MAX_EVENT_LOG_BATCH_EVENTS`` binds every batch
    # caller and not just the one that happens to exist. A batch over the cap would hand
    # ``_append_line`` more than one ``os.write`` can carry, forfeiting the ``O_APPEND``
    # atomicity the no-lock design rests on — a refusal is the cheaper answer.
    if len(events) > MAX_EVENT_LOG_BATCH_EVENTS:
        return False

    hosted = is_flag_enabled(server_mode)
    if hosted and event_log_id is None:
        return False

    log_path = (
        get_event_log_path(server_mode, event_log_id)
        if hosted
        else get_event_log_path()
    )
    if hosted:
        state = _hosted_log_state_by_path.get(log_path)
        if state is None:
            candidate_state = _EventLogState()
            if not _reserve_hosted_log(log_path, candidate_state):
                return False
            state = _state_for_log(log_path, hosted=True)
            state.reservation_checked = candidate_state.reservation_checked
        else:
            state = _state_for_log(log_path, hosted=True)
            if not _reserve_hosted_log(log_path, state):
                return False

        if _is_hosted_rate_limited(state):
            return False
    else:
        state = _state_for_log(log_path, hosted=False)

    if _is_log_full(log_path, state, hosted=hosted):
        return False

    timestamp = _get_timestamp()
    lines = []

    for event, details in events:
        line = _format_line(event, dict(details), timestamp)
        if line is None:
            return False

        lines.append(line)

    if not lines:
        return False

    _append_line("".join(lines), log_path, state, hosted=hosted)
    return True


def record_event(
    event: EventLogEvent, server_mode: Optional[Any] = None, **details: Any
) -> None:
    """Append one event, doing nothing at all if recording is disabled.

    The enabled check happens in the writer rather than being trusted to callers, so the
    writer is the thing that enforces it.
    """
    try:
        _write_events([(event, details)], _resolve_server_mode(server_mode))
    except Exception as error:
        # Instrumentation must never break the application it measures. Narrow
        # handlers miss real escapes (``UnicodeEncodeError`` is a ``ValueError``;
        # detail helpers can raise outside ``OSError``) — the cost of guessing wrong
        # is the thing this module promises cannot happen.
        _warn_write_failure(
            _local_log_state,
            "Unable to record event %s: %s",
            event.value,
            error,
        )


def validate_client_event(entry: Any) -> Tuple[EventLogEvent, Dict[str, Enum]]:
    """Resolve one posted event object against the schema, or refuse it outright.

    Takes the whole object rather than a name and a details mapping so the wire shape has
    a single owner. Split, the route implemented the closed-key rule for the envelope
    while this function implemented the same rule for ``details``, leaving one schema with
    two definitions in two modules — the transcription the tables above exist to prevent.

    Rejects rather than coerces, in every case. A missing ``kind`` defaulted to
    ``unknown`` would corrupt the denominator every feature ratio is read against, and
    a coerced value is indistinguishable afterwards from one the user really produced.

    Nothing client-supplied appears in the messages raised here — they describe what
    was expected instead. Echoing a rejected key or value back would put free-form text
    into a response from a subsystem that holds none.
    """
    if not isinstance(entry, dict):
        raise EventLogEventRejected("Each event must be an object")

    # Closed at the envelope level too, not only inside `details`. An ignored top-level
    # key writes nothing, but it lets a client believe it is sending a field that is
    # being dropped.
    if set(entry) - _CLIENT_EVENT_KEYS:
        raise EventLogEventRejected(
            f"An event carries only: {EVENT_FIELD}, {DETAILS_FIELD}"
        )

    name = entry.get(EVENT_FIELD)
    details = entry.get(DETAILS_FIELD)

    if not isinstance(name, str):
        raise EventLogEventRejected("Event name must be a string")

    try:
        event = EventLogEvent(name)
    except ValueError:
        raise EventLogEventRejected("Unknown event") from None

    if event not in CLIENT_EVENT_DETAIL_FIELDS:
        # `app_start` is a real member, so an unqualified `EventLogEvent(name)` accepts it.
        raise EventLogEventRejected("That event cannot be recorded by a client")

    expected = CLIENT_EVENT_DETAIL_FIELDS[event]

    if not isinstance(details, dict):
        raise EventLogEventRejected(
            f"Event {event.value} needs a details object with: {', '.join(expected)}"
        )

    # Exact match, so an unknown key and a missing one are the same failure. This is
    # also what refuses `ts`, `schema_version`, `run_id` and `count` as details: the
    # server owns those fields and none of them appears in any expected tuple.
    if set(details) != set(expected):
        raise EventLogEventRejected(
            f"Event {event.value} expects exactly these details: {', '.join(expected)}"
        )

    resolved: Dict[str, Enum] = {}
    for field in expected:
        value = details[field]
        if not isinstance(value, str):
            raise EventLogEventRejected(f"Detail {field} must be a string")

        try:
            # Enum membership subsumes the newline / `=` / space checks, since every
            # member already matches `_SAFE_VALUE_PATTERN`. `_format_line` keeps its own
            # guard so the two layers stay independently true.
            resolved[field] = _DETAIL_FIELD_ENUMS[field](value)
        except ValueError:
            raise EventLogEventRejected(
                f"Detail {field} is outside its permitted set of values"
            ) from None

    return event, resolved


def record_events(
    events: Sequence[Tuple[EventLogEvent, Mapping[str, Any]]],
    server_mode: Optional[Any] = None,
    event_log_id: Optional[str] = None,
) -> bool:
    """Append a batch of events, all of them or none, in a single write.

    All-or-nothing because the alternative leaves half a batch in a file whose bounded
    contents are the entire promise, and because a reader cannot tell a partial batch
    from a complete one. Formatting every line before writing any is what buys that. The
    one exception is a short write that then fails: the bytes already out stay on disk
    while this returns ``False``. That residue is indistinguishable from an NFS interleave
    and is quarantined by ``_summarise``, so it costs a skipped line rather than a
    misread one.

    ``details`` is an explicit mapping rather than ``**kwargs`` as in
    :func:`record_event`: with keyword expansion, a detail field named ``server_mode``
    would bind to the parameter instead of becoming a field, and a client-supplied
    ``server_mode=true`` would turn the enabled check against itself and silently drop
    the event. The schema refuses that key, but the batch path takes untrusted keys and
    should not depend on the schema to be safe.

    Returns whether the batch was written, so a caller can tell "recording is off" from
    "written" without inspecting the log. Never raises: instrumentation must not break
    the application it measures, least of all from a request handler.
    """
    resolved_server_mode = _resolve_server_mode(server_mode)
    try:
        return _write_events(
            events,
            resolved_server_mode,
            event_log_id=event_log_id,
        )
    except Exception as error:
        # One warning for the batch, and only for the first of a run of them: per-event
        # logging on a request path would turn one failed flush into a screenful, and a
        # persistent failure would turn every later flush into another screenful.
        state = _local_log_state
        if is_flag_enabled(resolved_server_mode) and _is_valid_event_log_id(
            event_log_id
        ):
            try:
                log_path = get_event_log_path(resolved_server_mode, event_log_id)
                state = _state_for_log(
                    log_path,
                    hosted=True,
                )
            except (OSError, ValueError):
                pass
        _warn_write_failure(
            state,
            "Unable to record %d events: %s",
            len(events),
            error,
        )
        return False


def record_app_start(config: Any, server_mode: Optional[Any] = None) -> None:
    """Record a launch, building details only when recording is actually on.

    Detail helpers (version, container detection) can raise outside ``OSError`` and
    must not run as ``record_event`` keyword arguments — those are evaluated before
    its ``try``. The enabled check here also avoids three file reads when the switch
    is off.
    """
    try:
        server_mode = _resolve_server_mode(server_mode)

        if not is_recording_enabled(server_mode):
            return

        record_event(
            EventLogEvent.APP_START,
            server_mode=server_mode,
            version=get_application_version(),
            deployment_mode=get_deployment_mode(getattr(config, "TT_METAL_HOME", None)),
            launch_mode=get_launch_mode(server_mode),
            os=get_operating_system(),
            python_version=get_python_version(),
        )
    except Exception as error:
        logger.warning(
            "Unable to record event %s: %s", EventLogEvent.APP_START.value, error
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
        # An NFS-interleaved fragment that happens to start on a key boundary parses
        # cleanly but has no timestamp or event, and summarising it would render an
        # empty `ts=` and a fabricated `event=unknown` — a garbled line dressed up as
        # a well-formed one, which the collector can no longer tell to skip.
        if fields is None or any(name not in fields for name in _REQUIRED_FIELDS):
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
        logger.debug("Skipping event log compaction: file locking is unavailable")
        return

    log_path = get_event_log_path()

    try:
        if not log_path.exists() or log_path.stat().st_size <= MAX_LOG_BYTES:
            return

        with open(
            get_event_log_directory() / COMPACTION_LOCK_NAME, "w", encoding="utf-8"
        ) as lock_file:
            try:
                fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                return

            try:
                _compact(log_path)
                # The refusal is sticky, so nothing would resume in this process without
                # this — `main()` compacts before serving, and the workers it spawns
                # inherit the module fresh, but a compaction from anywhere else would
                # otherwise leave recording off until restart.
                _invalidate_size_check()
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
    except OSError as error:
        logger.warning("Unable to compact the event log: %s", error)


def _compact(log_path: Path) -> None:
    # `errors="replace"` rather than a strict read: a `UnicodeDecodeError` is a
    # `ValueError`, so the `OSError` handler around this would not catch one, and
    # compaction runs from `main()` before gunicorn is spawned — a corrupted log
    # would stop the server starting rather than cost us a line.
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    split_at = len(lines) // 2
    if not split_at:
        return

    compacted = _summarise(lines[:split_at]) + lines[split_at:]
    # When the older half holds nothing summarisable, rewriting leaves the file at
    # the same length (or longer) and every later launch would pay the full cost
    # again for no reduction. Skip the replace — and its append-loss window — then.
    if len(compacted) >= len(lines):
        return

    # An append landing between the read above and the replace below goes to the old
    # inode and is lost. The window is a few milliseconds once a year, which is a
    # better trade than taking a lock on every append.
    temporary_path = log_path.with_name(f"{log_path.name}.compacting")
    temporary_path.write_text("\n".join(compacted) + "\n", encoding="utf-8")
    # ``write_text`` creates at ``0o666 & ~umask``; without this, ``os.replace``
    # would carry that mode onto the log and undo the ``0o600`` from ``_append_line``.
    os.chmod(temporary_path, 0o600)
    os.replace(temporary_path, log_path)
