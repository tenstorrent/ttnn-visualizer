# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Read stack-trace source file bodies from the report SQLite ``source_files`` table."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Dict, List, Optional, Set, Tuple

from ttnn_visualizer.stack_trace_source import _validate_stack_trace_raw_path

if TYPE_CHECKING:
    from ttnn_visualizer.models import SourceFile
    from ttnn_visualizer.queries import DatabaseQueries

# tt-metal's writer pairs each trace with one source file: the first path its
# `extract_stack_trace_file` (`ttnn/ttnn/stack_trace_source.py`) finds, a `File "…"`
# frame or a bare `path:line` line. These are copies of the writer's two patterns,
# not `TRACE_FRAME_REGEX`'s: they decide which raw path the trace's
# `source_file_id` belongs to, and only the writer's rule answers that.
_WRITER_FILE_FRAME = re.compile(r'^\s*File "([^"]+)", line \d+, in ')
_WRITER_PATH_WITH_LINE = re.compile(r"^\s*([^:\n]+):(\d+)(?::\d+)?\s*$")


def _writer_stack_trace_file(trace: object) -> Optional[str]:
    """The raw path tt-metal's writer stored the trace's ``source_file_id`` for,
    read as ``extract_stack_trace_file`` reads it."""
    # A BLOB a report keeps where text belongs names no path, as `_call_site` in
    # `agent/failures.py` reads it, rather than failing the whole listing.
    if not isinstance(trace, str) or not trace:
        return None
    for line in trace.splitlines():
        line = line.strip()
        if not line:
            continue
        match = _WRITER_FILE_FRAME.match(line)
        if match:
            return match.group(1)
        match = _WRITER_PATH_WITH_LINE.match(line)
        if match:
            return match.group(1)
    return None


def _source_file_has_contents(source_file: Optional["SourceFile"]) -> bool:
    # Treat empty contents as "unavailable" so the UI falls through to
    # tt-metal/SSH; matches test_lookup_by_id_skips_empty_contents.
    return source_file is not None and bool(source_file.contents)


def _validated_report_source_path(path: Optional[str]) -> Optional[str]:
    """
    Normalize a stack-trace path or return ``None`` if it fails validation.

    Used for both untrusted query parameters (``?filePath=``) and DB-stored
    ``source_files.path`` values so the same rules apply on the way in and on
    the way out (e.g. before paths enter a JSON ``resolved_path`` field).
    """
    if path is None:
        return None
    try:
        return _validate_stack_trace_raw_path(path)
    except ValueError:
        return None


def lookup_report_source_file(
    db: "DatabaseQueries",
    *,
    source_file_id: Optional[int] = None,
    file_path: Optional[str] = None,
) -> Optional["SourceFile"]:
    """
    Resolve a ``source_files`` row by primary key or exact path match.

    The query parameter ``file_path`` is validated up-front via
    ``_validated_report_source_path``. The row's stored ``path`` is re-validated
    at the HTTP boundary (``read_report_source_file`` /
    ``report_source_file_available``) so DB-supplied values cannot reach the
    JSON ``resolved_path`` field without passing the same rules.
    """
    if source_file_id is not None:
        source_file = db.get_source_file_by_id(source_file_id)
        if _source_file_has_contents(source_file):
            return source_file

    validated_file_path = _validated_report_source_path(file_path)
    if validated_file_path is not None:
        source_file = db.get_source_file_by_path(validated_file_path)
        if _source_file_has_contents(source_file):
            return source_file

    return None


def report_source_file_available(
    db: "DatabaseQueries",
    *,
    source_file_id: Optional[int] = None,
    file_path: Optional[str] = None,
) -> bool:
    """
    Lightweight availability probe used by ``GET /api/remote/stack-trace/test``.

    Returns only the stored ``path``, not ``source_files.contents``, though SQLite
    still reads the contents to check that they are non-empty. The same path validation that gates
    ``read_report_source_file`` applies here so unsafe stored paths report as
    unavailable instead of being approved for a read that would later fail.
    """
    validated_file_path = _validated_report_source_path(file_path)
    if source_file_id is None and validated_file_path is None:
        return False
    stored_path = db.get_source_file_path_if_present(
        source_file_id=source_file_id, file_path=validated_file_path
    )
    return (
        stored_path is not None
        and _validated_report_source_path(stored_path) is not None
    )


def read_report_source_file(
    db: "DatabaseQueries",
    *,
    source_file_id: Optional[int] = None,
    file_path: Optional[str] = None,
) -> Optional[Tuple[str, str]]:
    """
    Return ``(contents, resolved_path)`` when the report DB has a matching row.

    ``resolved_path`` is ``source_files.path`` returned in the JSON body of
    ``GET /api/remote/stack-trace/read``.
    """
    source_file = lookup_report_source_file(
        db, source_file_id=source_file_id, file_path=file_path
    )
    if source_file is None or source_file.contents is None:
        return None
    validated_path = _validated_report_source_path(source_file.path)
    if validated_path is None:
        return None
    return source_file.contents, validated_path


def _source_file_aliases(
    db: "DatabaseQueries", servable_ids: Set[int]
) -> Dict[int, List[str]]:
    """
    Raw trace paths by the servable file id their traces were stored with.

    The writer stores a file under its realpath, so a trace captured through a
    symlinked checkout names it by a path no ``source_files.path`` equals. Only the
    trace's own pairing says which file it is, and that needs no filesystem, so it
    holds for a report synced from another machine. A raw path paired with two ids
    is dropped: linking by its exact path, if any, is safer than guessing. That
    holds even when one of the ids cannot be served, so conflicts are found across
    every pairing and only then narrowed to servable ids.
    """
    id_by_raw_path: Dict[str, int] = {}
    conflicted: Set[str] = set()
    for source_file_id, trace in db.iter_stack_trace_source_refs():
        raw_path = _writer_stack_trace_file(trace)
        # Kept only as the trace spells it: the frontend looks a frame up by its
        # text, so a path validation would trim could never match.
        if (
            raw_path is None
            or _validated_report_source_path(raw_path) != raw_path
            or raw_path in conflicted
        ):
            continue
        known_id = id_by_raw_path.setdefault(raw_path, source_file_id)
        if known_id != source_file_id:
            del id_by_raw_path[raw_path]
            conflicted.add(raw_path)

    aliases: Dict[int, List[str]] = {}
    for raw_path, source_file_id in sorted(id_by_raw_path.items()):
        if source_file_id not in servable_ids:
            continue
        aliases.setdefault(source_file_id, []).append(raw_path)
    return aliases


def list_report_source_files(db: "DatabaseQueries") -> List[Dict[str, object]]:
    """
    Every source file the report can serve, as ``{"id", "path", "aliases"}``, for
    ``GET /api/source-files``.

    The frontend links a stack trace frame only when its file is listed, so this
    applies the same rules as ``report_source_file_available``: a row whose
    stored path fails validation is left out, as a probe would call it unavailable.

    ``aliases`` are the raw paths the report's traces name the file by, where
    they differ from every stored path, so frames past the first link by the id
    their path maps to. A stored path is never an alias: it names its own file.
    """
    files = [
        (source_file_id, validated_path)
        for source_file_id, path in db.query_source_file_index()
        if (validated_path := _validated_report_source_path(path)) is not None
    ]
    stored_paths = {path for _, path in files}
    aliases = _source_file_aliases(db, {source_file_id for source_file_id, _ in files})
    return [
        {
            "id": source_file_id,
            "path": path,
            "aliases": [
                alias
                for alias in aliases.get(source_file_id, [])
                if alias not in stored_paths
            ],
        }
        for source_file_id, path in files
    ]
