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
    """Reject unsafe ``source_files.path`` values before HTTP headers or reads."""
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

    The query parameter ``file_path`` is validated up-front. The row's stored
    ``path`` is re-validated at the HTTP boundary by ``read_report_source_file``
    and ``report_source_file_available`` so DB-supplied values cannot reach
    response headers without passing the same rules.
    """
    if source_file_id is not None:
        source_file = db.get_source_file_by_id(source_file_id)
        if _source_file_has_contents(source_file):
            return source_file

    if file_path:
        try:
            validated_path = _validate_stack_trace_raw_path(file_path)
        except ValueError:
            return None
        source_file = db.get_source_file_by_path(validated_path)
        if _source_file_has_contents(source_file):
            return source_file

    return None


def report_source_file_available(
    db: "DatabaseQueries",
    *,
    source_file_id: Optional[int] = None,
    file_path: Optional[str] = None,
) -> bool:
    # Mirror read_report_source_file: don't claim availability for a row whose
    # stored path can't safely become an X-TTNN-Resolved-Source-Path header.
    return (
        read_report_source_file(db, source_file_id=source_file_id, file_path=file_path)
        is not None
    )


def read_report_source_file(
    db: "DatabaseQueries",
    *,
    source_file_id: Optional[int] = None,
    file_path: Optional[str] = None,
) -> Optional[Tuple[str, str]]:
    """
    Return ``(contents, resolved_path)`` when the report DB has a matching row.

    ``resolved_path`` is ``source_files.path`` used as the resolved-path header
    (``X-TTNN-Resolved-Source-Path``) on ``GET /api/remote/stack-trace/read``.
    """
    source_file = lookup_report_source_file(
        db, source_file_id=source_file_id, file_path=file_path
    )
    if source_file is None:
        return None
    validated_path = _validated_report_source_path(source_file.path)
    if validated_path is None:
        return None
    return source_file.contents, validated_path
