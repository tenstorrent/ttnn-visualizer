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

from ttnn_visualizer.file_uploads import construct_dest_path, extract_npe_name


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
    # thread its id through the `?instanceId=` query param.
    instance_id = make_report()

    # The shared `conftest.app` fixture sets `LOCAL_DATA_DIRECTORY` as a
    # `str` to satisfy `SQLALCHEMY_DATABASE_URI`-style stringly-typed configs,
    # but production `settings.py:51` initialises it as a `Path` and the
    # handler does `data_directory / config["MLIR_DIRECTORY_NAME"]` (a `Path`
    # operation). Cast it here so the test exercises the same operand types
    # that the deployed app uses, without forking the shared fixture.
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])

    payload = {
        "files": (BytesIO(b"{}"), "../escape.json"),
    }
    response = client.post(
        f"/api/local/upload/mlir?instanceId={instance_id}",
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


def test_mlir_upload_invokes_configured_malware_scanner(app, client, make_report):
    """`/local/upload/mlir` must run the same `save_uploaded_files` scan path as other uploads.

    Deployments set `MALWARE_SCANNER` to whatever external scanner they use.
    This test uses a fake command name and asserts `subprocess.run` is
    invoked with that argv plus the temp copy of the upload.
    """
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["MALWARE_SCANNER"] = "mock-malware-scanner --check-only"

    mock_result = MagicMock(returncode=0, stdout="", stderr="")
    with patch(
        "ttnn_visualizer.file_uploads.subprocess.run", return_value=mock_result
    ) as mock_run:
        response = client.post(
            f"/api/local/upload/mlir?instanceId={instance_id}",
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
    """Non-zero scanner exit must surface as 422 and must not leave the file under MLIR dir."""
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["MALWARE_SCANNER"] = "mock-malware-scanner"

    mock_result = MagicMock(returncode=1, stdout="", stderr="infected")
    mlir_root = (
        Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config["MLIR_DIRECTORY_NAME"]
    ).resolve()

    with patch("ttnn_visualizer.file_uploads.subprocess.run", return_value=mock_result):
        response = client.post(
            f"/api/local/upload/mlir?instanceId={instance_id}",
            data={"files": (BytesIO(b"{}"), "bad.json")},
            content_type="multipart/form-data",
        )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert not any(p.name.endswith("bad.json") for p in mlir_root.glob("*.json"))
