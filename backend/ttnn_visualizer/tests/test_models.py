# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Deserialisation contract for persisted instance rows.

The connection validators guard the write path, but rows predate them, and every
instance-scoped request deserialises one — so a row the validators now reject has to
stay loadable rather than fail the request.
"""

import logging

from ttnn_visualizer.models import InstanceTable

VALID_STORED_CONNECTION = {
    "name": "lab",
    "username": "alice",
    "host": "work-gpu",
    "port": 22,
    "profilerPath": "/reports",
}

VALID_STORED_PROFILER_FOLDER = {
    "reportName": "resnet50",
    "remotePath": "/reports/resnet50",
    "lastModified": 1,
}


def _instance(remote_connection, remote_profiler_folder=None) -> InstanceTable:
    return InstanceTable(
        instance_id="test-instance-models",
        active_report={},
        remote_connection=remote_connection,
        remote_profiler_folder=remote_profiler_folder,
    )


def test_to_pydantic_keeps_a_valid_stored_connection():
    instance = _instance(VALID_STORED_CONNECTION)

    connection = instance.to_pydantic().remote_connection

    assert connection is not None
    assert connection.username == "alice"


# A username of "  " was storable before sanitise_ssh_username rejected empties. Raising
# on read would 500 every request against that instance with no way to clear it from the UI.
def test_to_pydantic_drops_a_connection_the_validators_now_reject(caplog):
    instance = _instance({**VALID_STORED_CONNECTION, "username": "   "})

    with caplog.at_level(logging.WARNING):
        pydantic_instance = instance.to_pydantic()

    assert pydantic_instance.remote_connection is None
    assert pydantic_instance.instance_id == "test-instance-models"
    assert "unusable stored remote connection" in caplog.text


# Documents an accepted regression: a relative path resolved against the SSH login home
# and worked, so requiring absolute paths costs these users their stored connection. It
# is dropped rather than raised on so the instance stays loadable and can be re-entered.
def test_to_pydantic_drops_a_connection_with_a_relative_report_path(caplog):
    instance = _instance(
        {**VALID_STORED_CONNECTION, "profilerPath": "tt-metal/generated/ttnn/reports"}
    )

    with caplog.at_level(logging.WARNING):
        pydantic_instance = instance.to_pydantic()

    assert pydantic_instance.remote_connection is None
    assert "unusable stored remote connection" in caplog.text


def test_to_pydantic_keeps_a_valid_stored_report_folder():
    instance = _instance(VALID_STORED_CONNECTION, VALID_STORED_PROFILER_FOLDER)

    folder = instance.to_pydantic().remote_profiler_folder

    assert folder is not None
    assert folder.remotePath == "/reports/resnet50"


# remotePath was discovered under a relative profilerPath, so it too could be stored
# relative. The local report paths live in their own columns, so dropping this row costs
# the sync badge rather than the loaded report.
def test_to_pydantic_drops_a_report_folder_the_validators_now_reject(caplog):
    instance = _instance(
        VALID_STORED_CONNECTION,
        {**VALID_STORED_PROFILER_FOLDER, "remotePath": "reports/resnet50"},
    )

    with caplog.at_level(logging.WARNING):
        pydantic_instance = instance.to_pydantic()

    assert pydantic_instance.remote_profiler_folder is None
    assert pydantic_instance.remote_connection is not None
    assert "unusable stored remote report folder" in caplog.text
