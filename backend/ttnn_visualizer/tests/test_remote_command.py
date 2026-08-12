# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the quoting contract every remote command depends on.

Each remote command is run by a shell on the remote host, so these are the checks
that stand between a crafted report path and arbitrary remote execution.
"""

import shlex
from pathlib import Path

from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.remote_command import (
    RemoteCommand,
    remote_arg,
    remote_glob_arg,
    remote_scp_target,
)

_APOSTROPHE_PATH = "/remote/o'brien/reports"
_INJECTION_PATH = "/remote/reports; touch /tmp/pwned"


def _connection() -> RemoteConnection:
    return RemoteConnection(
        name="lab",
        username="alice",
        host="work-gpu",
        port=22,
        profilerPath="/reports",
    )


class TestRemoteArg:
    def test_a_quoted_argument_round_trips_as_one_token(self):
        for path in (_APOSTROPHE_PATH, _INJECTION_PATH, "/a path/with spaces"):
            assert shlex.split(f"stat {remote_arg(path)}") == ["stat", path]

    def test_command_substitution_does_not_survive_quoting(self):
        quoted = remote_arg("/remote/$(touch /tmp/pwned)")

        assert quoted.startswith("'")
        assert shlex.split(f"stat {quoted}") == ["stat", "/remote/$(touch /tmp/pwned)"]

    def test_a_trailing_slash_is_preserved(self):
        # `_report_search_command` strips trailing slashes itself because GNU
        # and BSD `find` disagree on the root they echo; normalising here would take
        # that decision away from it.
        assert shlex.split(f"find {remote_arg('/reports/')}") == ["find", "/reports/"]
        assert shlex.split(f"find {remote_arg('//reports')}") == ["find", "//reports"]

    def test_a_path_is_accepted_and_not_normalised_further(self):
        assert shlex.split(f"cat {remote_arg(Path('/a b/c'))}") == ["cat", "/a b/c"]


class TestRemoteGlobArg:
    def test_the_wildcard_stays_expandable_while_the_path_is_quoted(self):
        pattern = "/remote/o'brien/*/config.json"
        quoted = remote_glob_arg(pattern)

        # Quote removal returns the pattern verbatim, so the apostrophe cannot close
        # the quoting early, yet the wildcard is left outside quotes for the shell.
        assert shlex.split(f"ls -1 {quoted}") == ["ls", "-1", pattern]
        assert "'*'" not in quoted

    def test_an_injection_attempt_around_a_wildcard_is_still_quoted(self):
        quoted = remote_glob_arg("/remote/*/; touch /tmp/pwned")

        assert shlex.split(f"ls -1 {quoted}") == [
            "ls",
            "-1",
            "/remote/*/; touch /tmp/pwned",
        ]


class TestRemoteScpTarget:
    def test_only_the_path_half_is_quoted(self):
        target = remote_scp_target(_connection(), _APOSTROPHE_PATH)

        # scp splits on the first colon locally, so user@host must stay bare while
        # the path is quoted for the shell that expands it under `-O`.
        assert target.startswith("alice@work-gpu:")
        path_half = target.split(":", 1)[1]
        assert shlex.split(path_half) == [_APOSTROPHE_PATH]

    def test_an_injection_attempt_in_the_path_is_quoted(self):
        target = remote_scp_target(_connection(), _INJECTION_PATH)

        assert shlex.split(target.split(":", 1)[1]) == [_INJECTION_PATH]


class TestRemoteCommand:
    def test_of_quotes_every_argument(self):
        command = RemoteCommand.of("stat", "-c", "%Y", _INJECTION_PATH)

        assert shlex.split(str(command)) == ["stat", "-c", "%Y", _INJECTION_PATH]

    def test_of_leaves_already_safe_tokens_unquoted(self):
        # Keeps commands readable in debug logs, and lets flags be passed positionally.
        assert str(RemoteCommand.of("stat", "-c", "%Y", "/reports")) == (
            "stat -c %Y /reports"
        )

    def test_of_supports_a_program_with_no_arguments(self):
        assert str(RemoteCommand.of("hostname")) == "hostname"

    def test_a_nested_script_is_quoted_as_a_single_argument(self):
        # `bash -lc <script>` is how multi-statement remote work is sent, and the
        # script has to arrive as one argv element.
        script = "find /reports -name 'config_*.json' -print"
        command = RemoteCommand.of("bash", "-lc", script)

        assert shlex.split(str(command)) == ["bash", "-lc", script]

    def test_from_shell_fragment_is_passed_through_verbatim(self):
        fragment = f"stat -c %Y {remote_arg(_INJECTION_PATH)} 2>/dev/null || echo"

        assert str(RemoteCommand.from_shell_fragment(fragment)) == fragment
