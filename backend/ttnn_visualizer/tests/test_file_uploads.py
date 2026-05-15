# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Regression tests for path-traversal hardening in file upload handling.

PR #1467 Copilot review (round 2) flagged that the MLIR upload path used
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
from unittest.mock import MagicMock, patch

from ttnn_visualizer.enums import ConnectionTestStates
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
    `subdir/file.csv` reaching `dest_path`. Path-traversal hardening for the
    folder branch is a broader follow-up tracked in PR_REVIEW_TRIAGE_2.md.
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


def test_construct_dest_path_folder_branch_traversal_posture_pinned(app, tmp_path):
    """Pin the documented posture: dedup may shorten an escape but never widens it.

    The folder-upload branch is intentionally permissive about sub-paths — it
    has to be, because Chromium and Safari alike legitimately carry
    `subdir/file.csv` patterns. A full path-traversal sweep across this
    branch is the explicit follow-up tracked at `PR_REVIEW_TRIAGE_2.md §1.J`.

    Until that lands, the contract this test pins is:

    * A `..` segment after the leading folder name CAN escape the per-report
      directory (this is the known gap), but
    * It MUST NOT escape `target_directory` itself (any future change that
      breaks this is a real regression).

    A future hardening commit should flip the first assertion (escape becomes
    blocked) without touching the second.
    """
    with app.app_context():
        dest = construct_dest_path(
            _faux_file("my-report/../escape"),
            tmp_path,
            folder_name="my-report",
        )
        resolved = dest.resolve()
        target = tmp_path.resolve()
        # Hard invariant: still inside `target_directory`.
        assert target in resolved.parents or resolved == target
        # Documented gap: lands beside the report folder, not under it.
        # When this stops being true (i.e. the file lands under
        # `<target>/my-report/`), the §1.J follow-up has shipped and this
        # test should be tightened to assert the new, stricter posture.
        assert resolved.parent == target


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


# ---- End-to-end regression: the MLIR upload endpoint ----------------------


def test_mlir_upload_traversal_does_not_escape_target_directory(
    app, client, make_report
):
    """POSTing a crafted filename must NOT write outside the MLIR directory.

    This is the integration-level counterpart to the unit tests above. It
    proves the handler wires `construct_dest_path` correctly *and* that no
    intermediate hop (e.g. malware-scanner branch, future refactor) re-introduces
    the traversal hole.
    """
    # The handler calls `update_instance(instance_id=...)` and requires a row
    # to update, so provision one via the standard `make_report` fixture and
    # thread its id through the `instanceId` query param.
    instance_id = make_report()

    # The shared `conftest.app` fixture sets `LOCAL_DATA_DIRECTORY` as a
    # `str` to satisfy `SQLALCHEMY_DATABASE_URI`-style stringly-typed configs,
    # but production `settings.py:51` initialises it as a `Path` and the
    # handler does `data_directory / config["MLIR_DIRECTORY_NAME"]` (a `Path`
    # operation). Cast it here so the test exercises the same operand types
    # that the deployed app uses, without forking the shared fixture.
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False

    payload = {
        "files": (BytesIO(b"{}"), "../escape.json"),
    }
    response = client.post(
        "/api/local/upload/mlir",
        query_string={"instanceId": instance_id},
        data=payload,
        content_type="multipart/form-data",
    )

    # The handler should still accept the upload (the filename ends in .json
    # after basename collapse), so 200 is the expected status.
    assert response.status_code == 200, response.get_data(as_text=True)

    # Walk the configured `LOCAL_DATA_DIRECTORY` and assert nothing was
    # written outside `<local>/<MLIR_DIRECTORY_NAME>/`.
    local_root = Path(app.config["LOCAL_DATA_DIRECTORY"]).resolve()
    mlir_root = (local_root / app.config["MLIR_DIRECTORY_NAME"]).resolve()
    assert mlir_root.exists(), "MLIR directory should have been created"

    for path in local_root.rglob("*"):
        if not path.is_file():
            continue
        # Every written file must live under `mlir_root` — no escapes.
        assert (
            mlir_root in path.resolve().parents or path.resolve() == mlir_root
        ), f"File escaped MLIR directory: {path.resolve()} (target: {mlir_root})"

    # And specifically: a file called `escape.json` (the basename after
    # collapse) should exist under `mlir_root`, NOT a file called
    # `passwd.json` under `local_root/etc/` (the pre-fix attack landing site).
    landed_files = list(mlir_root.glob("*escape.json"))
    assert (
        landed_files
    ), f"Expected `escape.json` under {mlir_root}, found: {list(mlir_root.iterdir())}"


def test_mlir_upload_forbidden_when_server_mode(app, client, make_report):
    """Hosted deployments (SERVER_MODE) must not accept MLIR uploads."""
    instance_id = make_report()
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/local/upload/mlir",
        query_string={"instanceId": instance_id},
        data={"files": (BytesIO(b"{}"), "model.json")},
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.FORBIDDEN
    body = response.get_json()
    assert body is not None
    assert "hosted" in body["error"].lower()


def test_mlir_upload_invokes_configured_malware_scanner(app, client, make_report):
    """`/local/upload/mlir` must run the same `save_uploaded_files` scan path as other uploads.

    Deployments set `MALWARE_SCANNER` to whatever external scanner they use.
    This test uses a fake command name and asserts `subprocess.run` is
    invoked with that argv plus the temp copy of the upload. `SERVER_MODE` is
    turned off so the request reaches the save path (hosted mode rejects first).
    """
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False
    app.config["MALWARE_SCANNER"] = "mock-malware-scanner --check-only"

    mock_result = MagicMock(returncode=0, stdout="", stderr="")
    with patch(
        "ttnn_visualizer.file_uploads.subprocess.run", return_value=mock_result
    ) as mock_run:
        response = client.post(
            "/api/local/upload/mlir",
            query_string={"instanceId": instance_id},
            data={"files": (BytesIO(b'{"x": 1}'), "model.json")},
            content_type="multipart/form-data",
        )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert mock_run.call_count == 1
    cmd = mock_run.call_args[0][0]
    assert cmd[:2] == ["mock-malware-scanner", "--check-only"]
    assert len(cmd) == 3
    assert Path(cmd[2]).is_file() is False  # temp file removed after clean scan + move


def test_mlir_upload_malware_scanner_positive_blocks_save(app, client, make_report):
    """Non-zero scanner exit must surface as 422 and must not leave the file under MLIR dir.

    `SERVER_MODE` is off so the handler runs the scan path instead of returning 403.
    """
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False
    app.config["MALWARE_SCANNER"] = "mock-malware-scanner"

    mock_result = MagicMock(returncode=1, stdout="", stderr="infected")
    mlir_root = (
        Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config["MLIR_DIRECTORY_NAME"]
    ).resolve()

    with patch("ttnn_visualizer.file_uploads.subprocess.run", return_value=mock_result):
        response = client.post(
            "/api/local/upload/mlir",
            query_string={"instanceId": instance_id},
            data={"files": (BytesIO(b"{}"), "bad.json")},
            content_type="multipart/form-data",
        )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert not any(p.name.endswith("bad.json") for p in mlir_root.glob("*.json"))


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
