# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.ssh_client import (
    is_ssh_host_key_verification_error,
    ssh_host_key_failure_message,
)


def test_is_ssh_host_key_verification_error_matches_strict_check_message():
    stderr = (
        "No ED25519 host key is known for [aus-wh-05]:45985 and you have "
        "requested strict checking.\nHost key verification failed.\n"
    )
    assert is_ssh_host_key_verification_error(stderr)


def test_is_ssh_host_key_verification_error_does_not_match_auth_failure():
    assert not is_ssh_host_key_verification_error("Permission denied (publickey).")


def test_ssh_host_key_failure_message_includes_non_default_port():
    connection = RemoteConnection(
        name="lab",
        username="user",
        host="aus-wh-05",
        port=45985,
        profilerPath="/remote",
    )
    message = ssh_host_key_failure_message(connection)
    assert "45985" in message
    assert "ssh -p 45985 user@aus-wh-05" in message
