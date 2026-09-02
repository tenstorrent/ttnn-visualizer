# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Local-only usage event log.

The application appends one ``key=value`` line per event to a file under a fixed
path in the user's home directory. Written on this machine only; the application
transmits nothing. An out-of-band collector may later read the file — that is
outside this process.

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
* **Compaction does not preserve line order across the summarised span.**
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
  overshoot by its worker count. Treat the cap as approximate. Compaction at the next
  launch summarises the older half and appends resume.

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
import uuid
from datetime import datetime, timezone
from enum import Enum
from importlib.metadata import PackageNotFoundError, distribution
from importlib.metadata import version as distribution_version
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple, Type

from ttnn_visualizer.utils import (
    is_running_in_container,
    parse_bool,
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
#
# Override for tests. Production resolves via :func:`get_usage_directory` on each
# call so ``Path.home()`` is not on the import path of ``settings`` (it raises
# ``RuntimeError`` when ``HOME`` is unset and the uid is absent from passwd).
USAGE_DIRECTORY: Optional[Path] = None
USAGE_LOG_NAME = "events.log"
DISABLED_MARKER_NAME = "disabled"
COMPACTION_LOCK_NAME = ".compaction.lock"

# Recording is on by default, so the variable is an opt-out rather than a switch: an
# operator who wants no usage data sets this, and everyone else sets nothing.
USAGE_DISABLED_ENV_VAR = "USAGE_RECORDING_DISABLED"

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
MAX_USAGE_BATCH_EVENTS = 50

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

# Fields that identify a single line rather than a class of them, and so cannot
# survive being summarised into a count.
_UNSUMMARISABLE_FIELDS = (TIMESTAMP_FIELD, RUN_ID_FIELD, COUNT_FIELD)

# Every line this module writes carries these, and so does every summary line, so a
# line without them is an interleaved fragment rather than an event.
_REQUIRED_FIELDS = (TIMESTAMP_FIELD, EVENT_FIELD, SCHEMA_VERSION_FIELD)

_run_id: Optional[str] = None

# Bytes appended since the last size check, primed so the first append of the process
# checks immediately — a log left over the cap by an earlier session must not get one
# free interval.
_bytes_since_size_check = LOG_SIZE_CHECK_INTERVAL_BYTES

# The directory this process has already created, so `_append_line` does not pay a
# `mkdir` (plus its caught `FileExistsError` and stat) on every request. Keyed on the
# path rather than a boolean so overriding `USAGE_DIRECTORY` invalidates it, which is
# what keeps the test fixture honest.
_ensured_directory: Optional[Path] = None

# Whether the last size check found the log over its cap. Cached rather than re-derived
# because `_bytes_since_size_check` only advances when an append lands: a refused batch
# moves nothing, so recomputing from the counter would hand the next batch a fresh
# interval and the log would keep growing, one interval per refusal. Cleared only when
# compaction has had a chance to give the log room again.
_log_full = False

# Whether a write failure has already been reported. The failures that reach the
# recorders are persistent rather than transient — a full disk, a permissions change, a
# directory the user removed — and they arrive on a route called often by design, so one
# warning per flush would fill the log of the application this module promises not to
# disturb.
_write_failure_logged = False
# Variables already warned about. ``is_recording_enabled`` is called on every config
# read — the ``PRINT_ENV`` dump alone triggers one through the descriptor, and every
# recorded event another — so an unconditional warning would bury the launch output it
# is meant to stand out in, and would be loudest in exactly the misconfigured case it
# is trying to report. One set rather than a flag per warning, so a third needs no new
# global and no ``global`` statement inside a predicate.
_warned_env_vars: Set[str] = set()


class UsageEvent(str, Enum):
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


class UsageView(str, Enum):
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
    VIEW_FIELD: UsageView,
}

# What a client may post, and the exact detail fields each event carries. Exported so
# the frontend enums and the docs page can be derived from one source rather than
# transcribed — a silent divergence there means events the client emits and the server
# rejects, which the client is designed not to notice.
#
# `APP_START` is deliberately absent: the server records launches itself, and a client
# able to post one could forge the deployment population every other figure is read
# against.
CLIENT_EVENT_DETAIL_FIELDS: Mapping[UsageEvent, Tuple[str, ...]] = {
    UsageEvent.REPORT_LOADED: (KIND_FIELD, SOURCE_FIELD),
    UsageEvent.REPORT_LOAD_FAILED: (KIND_FIELD, REASON_CLASS_FIELD),
    UsageEvent.VIEW_OPENED: (VIEW_FIELD,),
    UsageEvent.VIEW_ENGAGED: (VIEW_FIELD,),
}


class UsageEventRejected(Exception):
    """A posted event failed the schema above.

    Lives here rather than in ``exceptions.py`` because it carries no HTTP status and
    describes the log's schema, not a transport failure — the route decides what a
    rejection means over HTTP.

    The message must describe what was *expected*, never echo what arrived. A response
    body is one of the few ways client-supplied free-form text could re-enter a system
    whose whole point is that it holds none.
    """


def get_usage_directory() -> Path:
    """The one fixed location usage data is written to."""
    if USAGE_DIRECTORY is not None:
        return USAGE_DIRECTORY

    return Path.home() / ".ttnn-visualizer" / "usage"


def get_usage_log_path() -> Path:
    return get_usage_directory() / USAGE_LOG_NAME


def get_disabled_marker_path() -> Path:
    return get_usage_directory() / DISABLED_MARKER_NAME


def _nameable_marker_path() -> Optional[Path]:
    """The marker path when it can be resolved, ``None`` when it cannot.

    ``get_disabled_marker_path`` resolves ``Path.home()``, which raises ``RuntimeError``
    when ``HOME`` is unset and the uid is absent from passwd — the arbitrary-uid
    container pattern the note beside ``USAGE_DIRECTORY`` describes. The two sentences
    below are *advice*, so a path they cannot name is a clause to drop rather than a
    reason to raise: the settings override loop builds one while ``Config()`` is being
    constructed, and an exception there stops the app over a variable that configures
    nothing (#1937 review). Dropping the clause is also the truthful thing to say —
    without a resolvable home there is no directory for the marker to live in, so the
    environment variable really is the only control left.
    """
    try:
        return get_disabled_marker_path()
    except RuntimeError:
        return None


def describe_opt_out() -> str:
    """The sentence telling an operator how to switch recording off.

    One function because two places say it — the launch banner and the retired-variable
    warning — from the same two ingredients, and they have to agree. The rename that
    introduced this helper had to edit both in lockstep, which is the drift it prevents.
    """
    marker = _nameable_marker_path()
    if marker is None:
        return f"Switch it off with {USAGE_DISABLED_ENV_VAR}=true."

    return f"Switch it off with {USAGE_DISABLED_ENV_VAR}=true or by creating {marker}."


def describe_opt_in() -> str:
    """The sentence for an operator who wants recording on and hasn't got it.

    The inverse of :func:`describe_opt_out`, and here for the same reason: the marker
    path and the variable are written once, so the two directions can't drift into
    naming different controls.

    Asserts no current state, and names every switch rather than only the local pair.
    It is emitted from the settings override loop, which sees neither the marker file
    nor a posture applied outside the environment, so any sentence that claimed
    recording was on — or that clearing these two would turn it on — would be wrong for
    somebody. Both wordings have already been that: "recording is already on" misled an
    operator whose opt-out was in effect, and naming only the local pair sent a hosted
    operator round a loop neither control could end (#1937 review, twice).

    ``SERVER_MODE`` is named as a fact to explain the silence, and explicitly *not* as
    a control to change: it gates every ``@local_only`` endpoint, so an operator
    clearing it to chase the telemetry would open those instead.
    """
    marker = _nameable_marker_path()
    if marker is None:
        local = f"{USAGE_DISABLED_ENV_VAR}=false clears the local opt-out"
        regardless = "whatever it says"
    else:
        local = (
            f"{USAGE_DISABLED_ENV_VAR}=false and removing {marker} "
            "clear the two local opt-outs"
        )
        regardless = "whatever those say"

    return (
        "Recording is on by default on a local install. "
        f"{local}; under SERVER_MODE recording is off {regardless}, by design — "
        "SERVER_MODE gates the local-only endpoints and is not the control to change."
    )


def _as_bool(value: Any) -> bool:
    """Coerce a config value that may arrive as a string via ``settings_override``.

    Flask's ``settings_override`` path can inject raw strings without going through
    ``override_with_env_variables``, so a truthy ``"false"`` would otherwise disable
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


def _warn_once(env_var: str, message: str, *args: Any) -> None:
    """Emit one warning per variable for the life of the process.

    Keyed on the variable rather than the message, so changing an offending value
    mid-process does not earn a second warning — the operator has already been told
    which name to look at, which is the actionable part.
    """
    if env_var in _warned_env_vars:
        return

    _warned_env_vars.add(env_var)
    logger.warning(message, *args)


def _is_recording_disabled_by_environment() -> bool:
    """Whether the operator's environment asks us not to record.

    Unset means record. Anything set that is not a recognised *false* disables, which
    is the opposite of how every other boolean setting treats a value outside the
    vocabulary: :func:`_coerce_env_value` in ``settings`` discards an unrecognised one
    and keeps the declared default. That is right for a feature flag and wrong here.
    This is an opt-out, so ``USAGE_RECORDING_DISABLED=yes`` must not be read as
    consent — the cost of obeying a typo is one missing data point, and the cost of
    ignoring it is recording against an explicit request.
    """
    value = os.getenv(USAGE_DISABLED_ENV_VAR)
    if value is None:
        return False

    parsed = parse_bool(value)
    if parsed is None:
        _warn_once(
            USAGE_DISABLED_ENV_VAR,
            "%s=%r is not a recognised boolean. Treating it as a request to switch "
            "recording off; use true/1 or false/0.",
            USAGE_DISABLED_ENV_VAR,
            value,
        )
        return True

    return parsed


def is_recording_enabled(server_mode: Any = False) -> bool:
    """Whether usage may be written at all.

    Recording is on by default, and ``USAGE_RECORDING_DISABLED`` is the opt-out.

    The hosted deployment records nothing: a "local file on a managed machine" there
    would be a shared server file mixing many users, including external ones, which
    has a different privacy profile entirely.

    The file half of the off switch exists because an environment variable is
    per-shell, and so easy to set in one terminal and lose in the next.
    """
    if _as_bool(server_mode):
        return False

    if _is_recording_disabled_by_environment():
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


def get_launch_mode(server_mode: Any = False) -> LaunchMode:
    """How this process was launched, without exposing an installation path."""
    if _as_bool(server_mode):
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
    event: UsageEvent, details: Dict[str, Any], timestamp: str
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
                "Not recording usage event %s: field %s is not a safe logfmt value",
                event.value,
                key,
            )
            return None

    return _render_line(fields)


def _open_log() -> int:
    return os.open(get_usage_log_path(), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)


def _ensure_directory(directory: Path, force: bool = False) -> None:
    """Create the usage directory unless this process is known to have done so already.

    Cached because ``mkdir`` — plus its caught ``FileExistsError`` and stat — would
    otherwise run on every request. ``force`` re-creates it after an append has found it
    missing, which is the only way the cache can be wrong in a way retrying fixes.
    """
    global _ensured_directory

    if force or _ensured_directory != directory:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        _ensured_directory = directory


def _append_line(line: str) -> None:
    """Append one write, relying on ``O_APPEND`` instead of a lock.

    A single short write to a file opened ``O_APPEND`` is atomic on a local
    filesystem, so any number of instances can share the log with no coordination.
    That guarantee does not hold over NFS, where two simultaneous writers may
    interleave; readers of this file are expected to skip malformed lines.

    The argument may hold several newline-terminated lines, which is how a batch stays
    one write rather than N interleavable ones. Keeping it short enough to go out in a
    single ``os.write`` is the caller's job — that is what ``MAX_USAGE_BATCH_EVENTS``
    bounds — since the short-write loop below forfeits the guarantee if it has to
    iterate.
    """
    global _bytes_since_size_check, _ensured_directory, _write_failure_logged

    directory = get_usage_directory()
    _ensure_directory(directory)

    try:
        descriptor = _open_log()
    except FileNotFoundError:
        # The directory has gone since it was cached, which the docs actively invite by
        # offering a delete command. Recreate it and retry rather than losing this batch
        # and every batch after it to a condition one ``mkdir`` fixes.
        _ensure_directory(directory, force=True)
        descriptor = _open_log()
    except OSError:
        # A revoked permission or a full disk may equally be fixed before the next
        # append, so stop claiming the directory is known-good.
        _ensured_directory = None
        raise

    try:
        # ``os.write`` can return a short count without raising (e.g. a full disk).
        # Leaving a partial line would look identical to an NFS interleave.
        encoded = line.encode("utf-8")
        offset = 0
        while offset < len(encoded):
            written = os.write(descriptor, encoded[offset:])
            if written == 0:
                raise OSError("usage log write returned 0 bytes")
            offset += written

        _bytes_since_size_check += offset
        # Writes are landing again, so the next failure is worth a warning of its own.
        _write_failure_logged = False
    finally:
        os.close(descriptor)


def _is_log_full() -> bool:
    """Whether the log has reached its cap, re-measured at most once per interval.

    Refusing appends is the only correct answer at the cap. Trimming here is what makes
    cumulative totals go down, which Prometheus reads as a counter reset and then
    extrapolates — losing history and inventing activity at once. Compacting here is no
    better: ``_compact`` reads the whole file, and this runs on a request path.
    Compaction at the next launch summarises the older half and appends resume.

    Between measurements the previous verdict is returned rather than recomputed, and that
    is load-bearing rather than an optimisation. ``_bytes_since_size_check`` counts bytes
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
    global _bytes_since_size_check, _log_full

    if _bytes_since_size_check < LOG_SIZE_CHECK_INTERVAL_BYTES:
        return _log_full

    _bytes_since_size_check = 0
    was_full = _log_full

    try:
        _log_full = get_usage_log_path().stat().st_size > MAX_LOG_BYTES
    except OSError:
        # No log yet, or it is unreadable. Either way not full; a real write failure is
        # the append's problem to report, not this check's.
        _log_full = False

    if _log_full and not was_full:
        # Once, on the way in. Everything after this point is dropped and answered 204,
        # so without a line here a machine whose recording has stopped is indistinguishable
        # from a user who stopped using the application — the same misreading the refusal
        # itself exists to prevent.
        logger.warning(
            "Usage log has reached its %d byte cap; no further events will be recorded "
            "until it is compacted at the next launch",
            MAX_LOG_BYTES,
        )

    return _log_full


def _invalidate_size_check() -> None:
    """Force the next append to measure the log again.

    Called after compaction, which is the only thing that gives a full log room. It does
    not simply declare the log not-full because compaction does not promise to get under
    the cap — it skips the rewrite when the older half holds nothing summarisable — so the
    next append pays one stat and finds out for itself.
    """
    global _bytes_since_size_check, _log_full

    _log_full = False
    _bytes_since_size_check = LOG_SIZE_CHECK_INTERVAL_BYTES


def _warn_write_failure(message: str, *args: Any) -> None:
    """Report the first failure of a run of them, then stay quiet until a write lands.

    A persistent failure — a full disk, a revoked permission, a deleted directory — would
    otherwise produce one warning per flush on a route called often by design, so an
    instrumentation subsystem that must not disturb the application it measures would end
    up flooding that application's log instead. Repeats go to debug; ``_append_line``
    clears the latch as soon as a write succeeds, so a genuinely new failure is still
    reported.
    """
    global _write_failure_logged

    if _write_failure_logged:
        logger.debug(message, *args)
        return

    _write_failure_logged = True
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
    events: Sequence[Tuple[UsageEvent, Mapping[str, Any]]], server_mode: Any
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

    # Here rather than only at the route, so ``MAX_USAGE_BATCH_EVENTS`` binds every batch
    # caller and not just the one that happens to exist. A batch over the cap would hand
    # ``_append_line`` more than one ``os.write`` can carry, forfeiting the ``O_APPEND``
    # atomicity the no-lock design rests on — a refusal is the cheaper answer.
    if len(events) > MAX_USAGE_BATCH_EVENTS:
        return False

    if _is_log_full():
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

    _append_line("".join(lines))
    return True


def record_event(
    event: UsageEvent, server_mode: Optional[Any] = None, **details: Any
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
        _warn_write_failure("Unable to record usage event %s: %s", event.value, error)


def validate_client_event(entry: Any) -> Tuple[UsageEvent, Dict[str, Enum]]:
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
        raise UsageEventRejected("Each event must be an object")

    # Closed at the envelope level too, not only inside `details`. An ignored top-level
    # key writes nothing, but it lets a client believe it is sending a field that is
    # being dropped.
    if set(entry) - _CLIENT_EVENT_KEYS:
        raise UsageEventRejected(
            f"An event carries only: {EVENT_FIELD}, {DETAILS_FIELD}"
        )

    name = entry.get(EVENT_FIELD)
    details = entry.get(DETAILS_FIELD)

    if not isinstance(name, str):
        raise UsageEventRejected("Event name must be a string")

    try:
        event = UsageEvent(name)
    except ValueError:
        raise UsageEventRejected("Unknown usage event") from None

    if event not in CLIENT_EVENT_DETAIL_FIELDS:
        # `app_start` is a real member, so an unqualified `UsageEvent(name)` accepts it.
        raise UsageEventRejected("That usage event cannot be recorded by a client")

    expected = CLIENT_EVENT_DETAIL_FIELDS[event]

    if not isinstance(details, dict):
        raise UsageEventRejected(
            f"Event {event.value} needs a details object with: {', '.join(expected)}"
        )

    # Exact match, so an unknown key and a missing one are the same failure. This is
    # also what refuses `ts`, `schema_version`, `run_id` and `count` as details: the
    # server owns those fields and none of them appears in any expected tuple.
    if set(details) != set(expected):
        raise UsageEventRejected(
            f"Event {event.value} expects exactly these details: {', '.join(expected)}"
        )

    resolved: Dict[str, Enum] = {}
    for field in expected:
        value = details[field]
        if not isinstance(value, str):
            raise UsageEventRejected(f"Detail {field} must be a string")

        try:
            # Enum membership subsumes the newline / `=` / space checks, since every
            # member already matches `_SAFE_VALUE_PATTERN`. `_format_line` keeps its own
            # guard so the two layers stay independently true.
            resolved[field] = _DETAIL_FIELD_ENUMS[field](value)
        except ValueError:
            raise UsageEventRejected(
                f"Detail {field} is outside its permitted set of values"
            ) from None

    return event, resolved


def record_events(
    events: Sequence[Tuple[UsageEvent, Mapping[str, Any]]],
    server_mode: Optional[Any] = None,
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
    try:
        return _write_events(events, _resolve_server_mode(server_mode))
    except Exception as error:
        # One warning for the batch, and only for the first of a run of them: per-event
        # logging on a request path would turn one failed flush into a screenful, and a
        # persistent failure would turn every later flush into another screenful.
        _warn_write_failure("Unable to record %d usage events: %s", len(events), error)
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
            UsageEvent.APP_START,
            server_mode=server_mode,
            version=get_application_version(),
            deployment_mode=get_deployment_mode(getattr(config, "TT_METAL_HOME", None)),
            launch_mode=get_launch_mode(server_mode),
            os=get_operating_system(),
            python_version=get_python_version(),
        )
    except Exception as error:
        logger.warning(
            "Unable to record usage event %s: %s", UsageEvent.APP_START.value, error
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
                # The refusal is sticky, so nothing would resume in this process without
                # this — `main()` compacts before serving, and the workers it spawns
                # inherit the module fresh, but a compaction from anywhere else would
                # otherwise leave recording off until restart.
                _invalidate_size_check()
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
    except OSError as error:
        logger.warning("Unable to compact the usage log: %s", error)


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
