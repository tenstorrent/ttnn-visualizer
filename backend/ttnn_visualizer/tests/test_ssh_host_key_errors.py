# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from ttnn_visualizer.enums import HostKeyIssue
from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.ssh_client import (
    classify_ssh_host_key_error,
    is_ssh_host_key_verification_error,
    ssh_host_key_changed_message,
    ssh_host_key_unknown_message,
)

# Captured from OpenSSH by pointing `ssh -o BatchMode=yes` at a host with an empty
# UserKnownHostsFile. Under BatchMode this single line is the *whole* of stderr: the
# "No <TYPE> host key is known …" line needs StrictHostKeyChecking=yes, which the app
# never passes. Verbatim on purpose — a paraphrase would not catch a classifier that
# only matches the longer form.
UNKNOWN_HOST_STDERR = "Host key verification failed.\r\n"

# The same command against a known_hosts seeded with the wrong key. Note it also ends
# in "Host key verification failed." — which is why the changed fragments have to be
# tested first, and why this fixture keeps that final line.
CHANGED_HOST_STDERR = (
    "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n"
    "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n"
    "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n"
    "IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!\r\n"
    "Someone could be eavesdropping on you right now (man-in-the-middle attack)!\r\n"
    "It is also possible that a host key has just been changed.\r\n"
    "The fingerprint for the ED25519 key sent by the remote host is\r\n"
    "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.\r\n"
    "Please contact your system administrator.\r\n"
    "Add correct host key in /home/u/.ssh/known_hosts to get rid of this message.\r\n"
    "Offending ED25519 key in /home/u/.ssh/known_hosts:1\r\n"
    "Host key for aus-wh-05 has changed and you have requested strict checking.\r\n"
    "Host key verification failed.\r\n"
)

STRICT_CHECK_STDERR = (
    "No ED25519 host key is known for [aus-wh-05]:45985 and you have "
    "requested strict checking.\nHost key verification failed.\n"
)


def _connection(port: int = 45985) -> RemoteConnection:
    return RemoteConnection(
        name="lab",
        username="user",
        host="aus-wh-05",
        port=port,
        profilerPath="/remote",
    )


def test_a_bare_verification_failure_is_an_unknown_host():
    assert classify_ssh_host_key_error(UNKNOWN_HOST_STDERR) is HostKeyIssue.UNKNOWN


def test_the_strict_checking_variant_is_also_an_unknown_host():
    assert classify_ssh_host_key_error(STRICT_CHECK_STDERR) is HostKeyIssue.UNKNOWN


def test_a_changed_key_is_not_reported_as_an_unknown_one():
    """The regression the classification split exists for.

    Both stderrs contain "Host key verification failed.", so a single predicate matched
    them alike and a user whose host key changed under them — the case that may be a
    machine-in-the-middle — was told to accept the key and retry.
    """
    assert classify_ssh_host_key_error(CHANGED_HOST_STDERR) is HostKeyIssue.CHANGED


def test_classification_ignores_a_plain_auth_failure():
    assert classify_ssh_host_key_error("Permission denied (publickey).") is None


def test_the_predicate_still_covers_both_host_key_cases():
    """Callers that only need "is this about the host key" keep working."""
    assert is_ssh_host_key_verification_error(UNKNOWN_HOST_STDERR)
    assert is_ssh_host_key_verification_error(CHANGED_HOST_STDERR)
    assert not is_ssh_host_key_verification_error("Permission denied (publickey).")


def test_unknown_host_message_names_the_port_and_the_terminal_fallback():
    message = ssh_host_key_unknown_message(_connection())

    assert "45985" in message
    assert "ssh -p 45985 user@aus-wh-05" in message


def test_unknown_host_message_omits_the_port_flag_on_the_default_port():
    assert "ssh user@aus-wh-05" in ssh_host_key_unknown_message(_connection(port=22))


def test_changed_key_message_offers_removal_and_never_acceptance():
    """A changed key must not be one-clickable, and the copy must not invite it."""
    message = ssh_host_key_changed_message(_connection())

    assert "ssh-keygen -R '[aus-wh-05]:45985'" in message
    assert "accept" not in message.lower()


def test_changed_key_message_uses_the_bare_host_on_the_default_port():
    message = ssh_host_key_changed_message(_connection(port=22))

    assert "ssh-keygen -R aus-wh-05" in message
    # The bracket form is only how a non-default port is keyed; using it at 22 would
    # send the user to remove an entry that does not exist.
    assert "[" not in message
