# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Regression tests for mixed local/remote active_report path resolution (issue #1359)."""

from pathlib import Path

from ttnn_visualizer.extensions import db
from ttnn_visualizer.instances import (
    KEY_PERFORMANCE_LOCATION,
    KEY_PERFORMANCE_NAME,
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
