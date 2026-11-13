# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Regression tests for how an instance resolves, names and checks its report paths."""

import logging
import os
from pathlib import Path

import pytest
from ttnn_visualizer.exceptions import InvalidProfilerPath, InvalidReportPath
from ttnn_visualizer.extensions import db
from ttnn_visualizer.instances import (
    KEY_MLIR_LOCATION,
    KEY_MLIR_NAME,
    KEY_PERFORMANCE_LOCATION,
    KEY_PERFORMANCE_NAME,
    KEY_PROFILER_LOCATION,
    KEY_PROFILER_NAME,
    create_instance_from_local_paths,
    update_existing_instance,
)
from ttnn_visualizer.models import (
    InstanceTable,
    RemoteConnection,
    RemoteReportFolder,
    ReportLocation,
)


def test_local_performance_path_when_mounting_remote_profiler(app):
    """
    Mounting a remote memory report sets remote_connection while a local performance
    report may remain in active_report. performance_path must stay under LOCAL_DATA_DIRECTORY.
    """
    with app.app_context():
        perf_name = "err-report-local-1359"
        instance = InstanceTable(
            instance_id="test-instance-1359",
            active_report={
                KEY_PERFORMANCE_NAME: perf_name,
                KEY_PERFORMANCE_LOCATION: ReportLocation.LOCAL.value,
            },
            remote_connection=None,
            remote_profiler_folder=None,
            remote_performance_folder=None,
        )
        db.session.add(instance)
        db.session.commit()

        connection = RemoteConnection(
            name="conn",
            username="u",
            host="yyzc-wh-05",
            port=22,
            profilerPath="/data/profiler",
        )
        remote_profiler = RemoteReportFolder(
            reportName="remote-mem",
            remotePath="/home/user/remote-mem",
            lastModified=0,
        )

        update_existing_instance(
            instance,
            profiler_name="remote-mem",
            profiler_location=ReportLocation.REMOTE.value,
            performance_name=None,
            performance_location=None,
            npe_name=None,
            npe_location=None,
            mlir_name=None,
            mlir_location=None,
            remote_connection=connection,
            remote_profiler_folder=remote_profiler,
            remote_performance_folder=None,
            clear_remote=False,
        )

        local_root = Path(app.config["LOCAL_DATA_DIRECTORY"])
        perf_subdir = app.config["PERFORMANCE_DIRECTORY_NAME"]
        expected = str(local_root / perf_subdir / perf_name)

        assert instance.performance_path == expected
        assert connection.host not in (instance.performance_path or "")
        remote_root = Path(app.config["REMOTE_DATA_DIRECTORY"])
        assert not str(instance.performance_path or "").startswith(
            str(remote_root / connection.host)
        )


def test_mlir_path_remains_a_file_when_switching_unrelated_report(app):
    """
    Regression for PR #1467 review (Copilot comments B+C): uploading an MLIR
    file then switching an unrelated active report (e.g. profiler) must NOT
    overwrite `instance.mlir_path` with the MLIR *directory*. Pre-fix,
    `get_mlir_path()` ignored `mlir_name` and returned the directory, so
    `_resolve_report_path` recomputed mlir_path to a directory after any
    `PUT /instance` that didn't carry MLIR fields. `get_mlir_json()` then
    failed to `open()` it.
    """
    with app.app_context():
        mlir_name = "sample-model"
        instance = InstanceTable(
            instance_id="test-instance-mlir-preserve",
            active_report={
                KEY_MLIR_NAME: mlir_name,
                KEY_MLIR_LOCATION: ReportLocation.REMOTE.value,
            },
            remote_connection=RemoteConnection(
                name="conn",
                username="u",
                host="yyzc-wh-05",
                port=22,
                profilerPath="/data/profiler",
            ).model_dump(),
            remote_profiler_folder=None,
            remote_performance_folder=None,
        )
        db.session.add(instance)
        db.session.commit()

        # Caller updates the profiler but doesn't touch MLIR — exactly the
        # scenario the bug surfaced in.
        update_existing_instance(
            instance,
            profiler_name="some-profiler",
            profiler_location=ReportLocation.LOCAL.value,
            performance_name=None,
            performance_location=None,
            npe_name=None,
            npe_location=None,
            mlir_name=None,
            mlir_location=None,
            remote_connection=None,
            remote_profiler_folder=None,
            remote_performance_folder=None,
            clear_remote=False,
        )

        remote_root = Path(app.config["REMOTE_DATA_DIRECTORY"])
        mlir_subdir = app.config["MLIR_DIRECTORY_NAME"]
        expected_file = str(
            remote_root / "yyzc-wh-05" / mlir_subdir / f"{mlir_name}.json"
        )
        expected_dir = str(remote_root / "yyzc-wh-05" / mlir_subdir)

        # The path must point at a file, not the directory (the pre-fix value).
        assert instance.mlir_path == expected_file
        assert instance.mlir_path != expected_dir


# Reading an instance drops a stored connection the current validators reject rather than
# raising (models.stored_remote_connection). Updating one has to agree: a username of "  "
# was storable before sanitise_ssh_username rejected empties, and validating it strictly
# here would 500 every update against that row — including the one clearing the connection.
def test_update_tolerates_a_stored_connection_the_validators_now_reject(app, caplog):
    with app.app_context():
        instance = InstanceTable(
            instance_id="test-instance-legacy-connection",
            active_report={
                KEY_PROFILER_NAME: "some-profiler",
                KEY_PROFILER_LOCATION: ReportLocation.LOCAL.value,
            },
            remote_connection={
                "name": "conn",
                "username": "   ",
                "host": "yyzc-wh-05",
                "port": 22,
                "profilerPath": "/data/profiler",
            },
            remote_profiler_folder=None,
            remote_performance_folder=None,
        )
        db.session.add(instance)
        db.session.commit()

        with caplog.at_level(logging.WARNING):
            update_existing_instance(
                instance,
                profiler_name=None,
                profiler_location=None,
                performance_name=None,
                performance_location=None,
                npe_name=None,
                npe_location=None,
                mlir_name=None,
                mlir_location=None,
                remote_connection=None,
                remote_profiler_folder=None,
                remote_performance_folder=None,
                clear_remote=False,
            )

        assert "unusable stored remote connection" in caplog.text
        # Treated as absent, so the local report resolves under LOCAL_DATA_DIRECTORY
        # rather than a remote host directory.
        local_root = Path(app.config["LOCAL_DATA_DIRECTORY"])
        assert str(instance.profiler_path or "").startswith(str(local_root))


def test_a_report_directly_under_the_root_is_still_named():
    """An empty name reads as no active report, so the app would not open it."""
    from ttnn_visualizer.instances import _report_name

    assert _report_name(Path("/report")) == "report"
    assert _report_name(Path("/work/generated/ttnn/reports/bge_m3")) == "bge_m3"
    assert _report_name(None) == ""


@pytest.fixture
def unreadable_dir(tmp_path):
    """A report folder whose parent can't be searched, as `chmod 000` leaves it."""
    locked = tmp_path / "locked"
    report = locked / "report"
    report.mkdir(parents=True)
    locked.chmod(0)
    try:
        if os.access(report, os.F_OK):
            pytest.skip("this user reaches a folder whatever its parent's mode")
        yield report
    finally:
        locked.chmod(0o755)


@pytest.fixture(params=["missing", "a_file", "unreadable"])
def bad_path(request, tmp_path):
    """A path the check refuses: absent, a regular file, or unreadable."""
    if request.param == "missing":
        return tmp_path / "missing"
    if request.param == "a_file":
        path = tmp_path / "a_file"
        path.touch()
        return path
    return request.getfixturevalue("unreadable_dir")


@pytest.mark.parametrize(
    ("key", "error"),
    [("profiler_path", InvalidReportPath), ("performance_path", InvalidProfilerPath)],
)
def test_a_path_that_is_not_a_readable_folder_is_refused(app, bad_path, key, error):
    """`main()` exits cleanly on these; an unreadable one used to be a traceback."""
    paths = {"profiler_path": None, "performance_path": None, key: str(bad_path)}

    with app.app_context():
        with pytest.raises(error):
            create_instance_from_local_paths(**paths)

        assert InstanceTable.query.count() == 0


def test_a_good_memory_report_beside_a_bad_performance_path_makes_no_instance(
    app, tmp_path, bad_path
):
    """Both paths are checked before the row is written."""
    memory_report = tmp_path / "memory_report"
    memory_report.mkdir()

    with app.app_context():
        with pytest.raises(InvalidProfilerPath):
            create_instance_from_local_paths(str(memory_report), str(bad_path))

        assert InstanceTable.query.count() == 0
