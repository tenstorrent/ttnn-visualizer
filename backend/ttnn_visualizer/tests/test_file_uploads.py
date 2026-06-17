# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Regression tests for path-traversal hardening in file upload handling.

PR #1467 Copilot review (round 2) flagged that upload paths used
`file.filename` verbatim when constructing the destination path, allowing a
crafted multipart filename like `"../etc/passwd.json"` or `"/etc/passwd.json"`
to escape `target_directory`. These tests pin the hardening (`Path(...).name`
in `construct_dest_path` and `extract_npe_name`) so a future refactor can't
silently undo it.
"""

from http import HTTPStatus
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.file_uploads import (
    construct_dest_path,
    extract_npe_name,
    resolve_parent_folder_name,
    validate_files,
)


def _faux_file(filename):
    """Minimal stand-in for `werkzeug.datastructures.FileStorage`.

    Only the `.filename` attribute is read by `construct_dest_path`; using a
    `SimpleNamespace` avoids dragging the werkzeug import into a pure
    function test that doesn't need an HTTP request at all.
    """
    return SimpleNamespace(filename=filename)


# ---- construct_dest_path: single-file branch (NPE / MLIR shape) ----------


def test_construct_dest_path_strips_relative_traversal_segments(app, tmp_path):
    """`"../etc/passwd.json"` must land at `<target>/passwd.json`, not escape."""
    with app.app_context():
        dest = construct_dest_path(
            _faux_file("../etc/passwd.json"), tmp_path, folder_name=None
        )
        # Resolved destination must be a *child* of `tmp_path`.
        assert tmp_path.resolve() in dest.resolve().parents
        # And the basename must be the post-`.name` value (prefixed in
        # SERVER_MODE; bare in local mode). Either way it ends in `passwd.json`.
        assert dest.name.endswith("passwd.json")


def test_construct_dest_path_strips_absolute_filename(app, tmp_path):
    """`"/etc/passwd.json"` must NOT replace `target_directory` wholesale."""
    with app.app_context():
        dest = construct_dest_path(
            _faux_file("/etc/passwd.json"), tmp_path, folder_name=None
        )
        assert tmp_path.resolve() in dest.resolve().parents
        # Pre-fix, `Path(target) / "/etc/passwd.json"` collapsed to
        # `Path("/etc/passwd.json")` and we'd never reach this assertion
        # because the parent chain wouldn't include `tmp_path`.
        assert "/etc" not in str(dest.resolve())


def test_construct_dest_path_preserves_legitimate_filename(app, tmp_path):
    """Plain filenames must round-trip unchanged (modulo SERVER_MODE prefix)."""
    with app.app_context():
        dest = construct_dest_path(_faux_file("model.json"), tmp_path, folder_name=None)
        assert dest.name.endswith("model.json")
        assert tmp_path.resolve() in dest.resolve().parents


def test_construct_dest_path_preserves_unicode_filename(app, tmp_path):
    """Critically, `.name` must NOT mangle Unicode (unlike `secure_filename`)."""
    with app.app_context():
        dest = construct_dest_path(
            _faux_file("我的模型.json"), tmp_path, folder_name=None
        )
        # The exact byte sequence "我的模型.json" must survive intact.
        assert dest.name.endswith("我的模型.json")


# ---- construct_dest_path: folder-upload branch is intentionally unchanged --


def test_construct_dest_path_folder_branch_unchanged_for_subpaths(app, tmp_path):
    """Folder uploads legitimately carry sub-paths; hardening must not break them.

    `validate_files` / `os.utime` accounting rely on filenames like
    `subdir/file.csv` reaching `dest_path`. The folder branch's traversal
    hardening is a *resolved-path containment* check (see the dedicated
    `_rejects_*` tests below), which permits legitimate sub-paths and only
    rejects candidates whose resolved path escapes the per-report folder.
    """
    with app.app_context():
        dest = construct_dest_path(
            _faux_file("subdir/file.csv"), tmp_path, folder_name="my-report"
        )
        # The sub-path is preserved (this is the legitimate behaviour).
        assert dest.parts[-2:] == ("subdir", "file.csv")


def test_construct_dest_path_folder_branch_dedupes_leading_segment(app, tmp_path):
    """Chromium sends `<report>/db.sqlite`; we must not double-prefix the folder.

    Chromium-based browsers send each file's `webkitRelativePath` as the
    multipart filename, so the report folder name is already the first segment
    of `file.filename`. Without dedup, a `folder_name="my-report"` upload of
    `my-report/db.sqlite` would land at `my-report/my-report/db.sqlite`,
    creating a stray directory beside the real report.
    """
    with app.app_context():
        dest = construct_dest_path(
            _faux_file("my-report/db.sqlite"),
            tmp_path,
            folder_name="my-report",
        )
        # The basename is the final part. The folder segment may carry a
        # `<timestamp>_` prefix in SERVER_MODE so we match the suffix only.
        assert dest.name == "db.sqlite"
        assert dest.parent.name.endswith("my-report")
        assert dest.parent.parent == tmp_path
        # And critically: no double-prefix anywhere in the resolved path.
        assert "my-report/my-report" not in str(dest)


def test_construct_dest_path_folder_branch_safari_basename_only(app, tmp_path):
    """Safari sends just the basename plus a separate `folderName` form field.

    The dedup logic added for Chromium must not regress the Safari case where
    `file.filename` is already a bare basename.
    """
    with app.app_context():
        dest = construct_dest_path(
            _faux_file("db.sqlite"),
            tmp_path,
            folder_name="my-report",
        )
        assert dest.name == "db.sqlite"
        assert dest.parent.name.endswith("my-report")
        assert dest.parent.parent == tmp_path


def test_construct_dest_path_folder_branch_rejects_escape_via_dotdot(app, tmp_path):
    """Resolved-path containment: `../` after the leading folder must be rejected.

    Folder uploads legitimately carry sub-paths in `file.filename`, so we
    can't collapse to the basename the way the single-file branch does.
    `construct_dest_path` instead resolves the candidate path and requires
    it to stay inside the per-report directory; a `..` segment that lands
    beside the report folder (the pre-fix "documented gap") is now an error.
    """
    with app.app_context():
        with pytest.raises(DataFormatError):
            construct_dest_path(
                _faux_file("my-report/../escape"),
                tmp_path,
                folder_name="my-report",
            )


def test_construct_dest_path_folder_branch_rejects_deep_dotdot_escape(app, tmp_path):
    """Multi-segment `../../..` escapes (beyond `target_directory`) are rejected too."""
    with app.app_context():
        with pytest.raises(DataFormatError):
            construct_dest_path(
                _faux_file("my-report/../../../etc/passwd"),
                tmp_path,
                folder_name="my-report",
            )


def test_construct_dest_path_folder_branch_rejects_absolute_filename(app, tmp_path):
    """An absolute `file.filename` in the folder branch must not replace the root."""
    with app.app_context():
        with pytest.raises(DataFormatError):
            construct_dest_path(
                _faux_file("/etc/passwd"),
                tmp_path,
                folder_name="my-report",
            )


def test_construct_dest_path_folder_branch_allows_intermediate_dotdot(app, tmp_path):
    """`subdir/../file.csv` resolves back into the report dir and must pass.

    The containment check is on the resolved path, not a textual `..` scan,
    so paths whose `..` segments cancel out before leaving the report folder
    are still legitimate (e.g. a sibling-subdir reference that ends up at
    `report_root/file.csv`).
    """
    with app.app_context():
        dest = construct_dest_path(
            _faux_file("my-report/subdir/../file.csv"),
            tmp_path,
            folder_name="my-report",
        )
        # `construct_dest_path` returns the un-resolved path so consumers see
        # the literal sub-path they supplied; the containment guarantee is on
        # the *resolved* form. The report directory carries a `<timestamp>_`
        # prefix in SERVER_MODE so we match the resolved parent by suffix
        # rather than reconstructing the prefix here.
        resolved = dest.resolve()
        assert resolved.name == "file.csv"
        assert resolved.parent.name.endswith("my-report")
        assert resolved.parent.parent == tmp_path.resolve()


# ---- extract_npe_name: feeds the DB; rebuilt into a read path later --------


def test_extract_npe_name_strips_traversal_from_db_name():
    """`mlir_name` is rebuilt by `get_mlir_path` — must not contain `..`."""
    name = extract_npe_name([_faux_file("../etc/passwd.json")])
    assert name == "passwd"
    assert ".." not in name
    assert "/" not in name


def test_extract_npe_name_strips_absolute_path_from_db_name():
    name = extract_npe_name([_faux_file("/etc/passwd.json")])
    assert name == "passwd"
    assert "/" not in name


def test_extract_npe_name_preserves_legitimate_basename():
    """Plain filenames must produce the same DB name they always did."""
    assert extract_npe_name([_faux_file("my-model.json")]) == "my-model"
    assert extract_npe_name([_faux_file("my-trace.npeviz.zst")]) == "my-trace"


def test_extract_npe_name_handles_empty_input():
    assert extract_npe_name([]) is None


# ---- resolve_parent_folder_name: keeps both upload handlers aligned --------


def test_resolve_parent_folder_name_prefers_explicit_safari_form_field():
    """An explicit `folderName` form field always wins over filename inference.

    Safari sends the destination folder name as a separate form field because
    its multipart filename is just the basename. The helper must take the
    explicit value verbatim rather than fall back to the (basename-only)
    filename, which would otherwise produce nonsense like `db.sqlite`.
    """
    result = resolve_parent_folder_name(
        [_faux_file("db.sqlite")], folder_name="my-report"
    )
    assert result == "my-report"


def test_resolve_parent_folder_name_falls_back_to_filename_for_chromium():
    """Chromium sends `folderName=None`; infer from the relative filename."""
    result = resolve_parent_folder_name(
        [_faux_file("my-report/db.sqlite")], folder_name=None
    )
    assert result == "my-report"


def test_resolve_parent_folder_name_treats_empty_form_field_as_missing():
    """An empty `folderName` (vs missing) must still trigger the fallback.

    `request.form.get("folderName")` returns ``None`` when the field is
    missing, but a client that sends an empty string would otherwise short-
    circuit the inference and silently land files at the target root.
    """
    result = resolve_parent_folder_name(
        [_faux_file("my-report/db.sqlite")], folder_name=""
    )
    assert result == "my-report"


def test_resolve_parent_folder_name_handles_empty_files():
    """No files and no explicit folder → nothing to resolve."""
    assert resolve_parent_folder_name([], folder_name=None) is None


# ---- validate_files: cross-file leading-segment consistency ---------------


def test_validate_files_rejects_inferred_uploads_spanning_multiple_folders():
    """Mixed-folder Chromium upload must fail validation, not nest silently.

    When the destination folder is inferred from the files themselves,
    `resolve_parent_folder_name` reads `files[0]` only and the dedup in
    `construct_dest_path` keys on that single name. Without this guard, an
    upload like `reportA/db.sqlite` + `reportB/config.json` would silently
    land as `reportA/db.sqlite` + `reportA/reportB/config.json`. Reject it
    instead so the client can re-pick a single folder.
    """
    files = [
        _faux_file("reportA/db.sqlite"),
        _faux_file("reportB/config.json"),
    ]
    assert validate_files(files, {"db.sqlite"}, folder_name=None) is False


def test_validate_files_accepts_inferred_upload_with_consistent_folder():
    """Single-folder Chromium upload (the normal case) must still validate."""
    files = [
        _faux_file("my-report/db.sqlite"),
        _faux_file("my-report/config.json"),
        _faux_file("my-report/cluster_descriptor.yaml"),
    ]
    assert validate_files(files, {"db.sqlite"}, folder_name=None) is True


def test_validate_files_skips_consistency_check_when_folder_name_is_explicit():
    """Safari sends bare basenames + an explicit `folderName`; nothing to compare.

    The new cross-file check only fires when the destination folder is being
    inferred from the relative paths. With an explicit `folderName` the
    inference path is bypassed, so this guard must not interfere even with
    files carrying disagreeing sub-paths (those are sub-directories *inside*
    the report, not separate reports).
    """
    files = [
        _faux_file("db.sqlite"),
        _faux_file("subdir-a/file.csv"),
        _faux_file("subdir-b/other.csv"),
    ]
    assert validate_files(files, {"db.sqlite"}, folder_name="my-report") is True


# ---- End-to-end regression: profiler/performance uploads keep folder layout ---


def test_profiler_upload_chromium_style_lands_under_report_folder(
    app, client, make_report
):
    """Chromium sends `<report>/db.sqlite`; uploads must land under that folder.

    Regression for the bug where `create_profiler_files` passed the raw
    `folderName` form field (None for non-Safari browsers) to
    `save_uploaded_files` instead of the resolved report name, causing every
    file to be written directly into `profiler-reports/` and clobbering / mixing
    with sibling reports.
    """
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False

    profiler_root = (
        Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config["PROFILER_DIRECTORY_NAME"]
    ).resolve()

    response = client.post(
        "/api/local/upload/profiler",
        query_string={"instanceId": instance_id},
        data={
            "files": [
                (BytesIO(b"sqlite-bytes"), "unique_name2/db.sqlite"),
                (BytesIO(b"{}"), "unique_name2/config.json"),
            ],
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    body = response.get_json()
    assert body["path"] == "unique_name2"

    report_dir = profiler_root / "unique_name2"
    assert (report_dir / "db.sqlite").is_file()
    assert (report_dir / "config.json").is_file()
    # Critical: nothing was written at the root of `profiler-reports/`.
    assert not (profiler_root / "db.sqlite").exists()
    assert not (profiler_root / "config.json").exists()
    # Critical: no double-prefix directory like `unique_name2/unique_name2/`.
    assert not (report_dir / "unique_name2").exists()


def test_profiler_upload_safari_style_lands_under_report_folder(
    app, client, make_report
):
    """Safari sends bare basenames plus a separate `folderName` form field.

    Both Safari and Chromium uploads must land at the same destination layout.
    """
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False

    profiler_root = (
        Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config["PROFILER_DIRECTORY_NAME"]
    ).resolve()

    response = client.post(
        "/api/local/upload/profiler",
        query_string={"instanceId": instance_id},
        data={
            "files": [
                (BytesIO(b"sqlite-bytes"), "db.sqlite"),
                (BytesIO(b"{}"), "config.json"),
            ],
            "folderName": "safari_report",
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    body = response.get_json()
    assert body["path"] == "safari_report"

    report_dir = profiler_root / "safari_report"
    assert (report_dir / "db.sqlite").is_file()
    assert (report_dir / "config.json").is_file()
    assert not (profiler_root / "db.sqlite").exists()


def test_profiler_upload_rejects_files_from_multiple_folders(app, client, make_report):
    """Mixed-folder Chromium uploads must be rejected, not silently nested.

    Pre-fix, an upload combining files from two different report folders
    inferred the destination from `files[0]` and the disagreeing file ended
    up nested as `<inferred>/<other-folder>/<file>`. The handler now returns
    the standard `FAILED` status and writes nothing.
    """
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False

    profiler_root = (
        Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config["PROFILER_DIRECTORY_NAME"]
    ).resolve()

    response = client.post(
        "/api/local/upload/profiler",
        query_string={"instanceId": instance_id},
        data={
            "files": [
                (BytesIO(b"sqlite-bytes"), "reportA/db.sqlite"),
                (BytesIO(b"{}"), "reportB/config.json"),
            ],
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    body = response.get_json()
    # The handler returns a `StatusMessage` with the int-valued
    # `ConnectionTestStates` enum; FAILED is `2` after JSON serialisation.
    assert body["status"] == ConnectionTestStates.FAILED.value

    # Nothing should have been written under either folder.
    assert not (profiler_root / "reportA").exists()
    assert not (profiler_root / "reportB").exists()
    # And especially: no surprise nesting like `reportA/reportB/config.json`.
    if profiler_root.exists():
        for path in profiler_root.rglob("*"):
            if path.is_file():
                raise AssertionError(
                    f"Mixed-folder upload should have been rejected, found: {path}"
                )


def test_performance_upload_chromium_style_lands_under_report_folder(
    app, client, make_report
):
    """Same Chromium regression for `/api/local/upload/performance`."""
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False

    perf_root = (
        Path(app.config["LOCAL_DATA_DIRECTORY"])
        / app.config["PERFORMANCE_DIRECTORY_NAME"]
    ).resolve()

    response = client.post(
        "/api/local/upload/performance",
        query_string={"instanceId": instance_id},
        data={
            "files": [
                (BytesIO(b"csv,bytes\n"), "perf_run/profile_log_device.csv"),
                (BytesIO(b"tracy"), "perf_run/tracy_profile_log_host.tracy"),
                (BytesIO(b"op,perf\n"), "perf_run/ops_perf_results_2026.csv"),
            ],
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)

    report_dir = perf_root / "perf_run"
    assert (report_dir / "profile_log_device.csv").is_file()
    assert (report_dir / "tracy_profile_log_host.tracy").is_file()
    assert any(p.name.startswith("ops_perf_results") for p in report_dir.iterdir())
    assert not (perf_root / "profile_log_device.csv").exists()
    assert not (report_dir / "perf_run").exists()


def test_profiler_upload_rejects_traversal_within_folder(app, client, make_report):
    """Folder upload with a `../`-bearing filename must 422 and stay contained.

    End-to-end counterpart to the `construct_dest_path` unit tests: confirms
    the handler propagates `DataFormatError` from the upload pipeline as the
    expected 422 status, that no file from the batch escapes the profiler
    directory, and that the traversal-bearing `escape.json` is never written.
    Earlier files in the batch may land on disk before the bad one raises —
    that non-atomic behaviour is preserved here and is not what this test
    targets.
    """
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False

    profiler_root = (
        Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config["PROFILER_DIRECTORY_NAME"]
    ).resolve()

    response = client.post(
        "/api/local/upload/profiler",
        query_string={"instanceId": instance_id},
        data={
            "files": [
                (BytesIO(b"sqlite-bytes"), "evil_report/db.sqlite"),
                (BytesIO(b"{}"), "evil_report/../escape.json"),
            ],
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY, response.get_data(
        as_text=True
    )

    # The legitimate first file may have been written before the bad one
    # raised (this is the existing non-atomic-upload behaviour and is not
    # what this fix targets), but nothing must have *escaped* the profiler
    # directory — the whole point of the containment check.
    local_root = Path(app.config["LOCAL_DATA_DIRECTORY"]).resolve()
    for path in local_root.rglob("*"):
        if not path.is_file():
            continue
        resolved = path.resolve()
        assert (
            profiler_root in resolved.parents or resolved == profiler_root
        ), f"File escaped profiler directory: {resolved}"
        # And specifically: no `escape.json` landed *anywhere*.
        assert (
            path.name != "escape.json"
        ), f"`../escape.json` should have been rejected, found {resolved}"
