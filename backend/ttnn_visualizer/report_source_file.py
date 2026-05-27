# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Read stack-trace source file bodies from the report SQLite ``source_files`` table."""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional, Tuple

from ttnn_visualizer.stack_trace_source import _validate_stack_trace_raw_path

if TYPE_CHECKING:
    from ttnn_visualizer.models import SourceFile
    from ttnn_visualizer.queries import DatabaseQueries


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

    Avoids loading ``source_files.contents`` (which can be large) by asking the
    DB only for the stored ``path``. The same path validation that gates
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
