# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Construction of remote shell commands, and the quoting they depend on.

Every remote command this app runs is executed by a shell on the remote host:
``ssh host cmd arg…`` concatenates the arguments after the target with spaces and
hands the result to the login shell, and ``scp -O`` expands its remote path there
too. So a report path typed into the connection form reaches a shell, and nothing
but quoting stands between a crafted path and arbitrary remote execution.

``RemoteCommand`` exists so that invariant is checked by the type checker rather
than by reviewer attention: the runners take a ``RemoteCommand``, which is built here
and nowhere else. A naive f-string at a call site is a type error.

That check needs the whole package in one invocation, as ``pnpm flask:mypy`` does.
``follow_imports = "skip"`` in ``pyproject.toml`` means a single-file mypy run
resolves imported types to ``Any`` and reports nothing, so the type error only
surfaces when every module is in the checked set.
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Union

from ttnn_visualizer.models import RemoteConnection

PathLike = Union[str, Path]


def remote_arg(value: PathLike) -> str:
    """Quote one value for use as a single argument in a remote shell command.

    Deliberately does not route through ``Path``: that would normalise ``/a/`` to
    ``/a`` and ``//a`` to ``/a``, and ``_report_search_command`` manages
    trailing slashes itself because GNU and BSD ``find`` disagree on whether the
    root they echo keeps one.
    """
    return shlex.quote(str(value))


def remote_glob_arg(pattern: str) -> str:
    """Shell-quote a remote path while leaving ``*`` free to expand on the host.

    ``shlex.quote`` on the whole pattern would quote the wildcard too, turning a
    glob the caller depends on into a literal filename. Quoting each side of the
    wildcards instead keeps the expansion while closing the quote-escape that a
    hand-rolled ``'{path}'`` leaves open.
    """
    return "*".join(shlex.quote(segment) for segment in pattern.split("*"))


def remote_scp_target(connection: RemoteConnection, remote_path: PathLike) -> str:
    """Build the ``user@host:path`` argument for scp, quoting the path.

    scp splits the argument at the first colon locally and sends the remainder to
    a shell on the remote host, so the path half needs the same quoting as any
    other remote argument even though the whole token is passed through argv.
    """
    return f"{connection.username}@{connection.host}:{remote_arg(remote_path)}"


@dataclass(frozen=True)
class RemoteCommand:
    """A command line ready to be run by a shell on the remote host.

    Build one with :meth:`of` or :meth:`from_shell_fragment`, so a value of this type
    means someone decided how each argument was quoted. The field is private because
    ``RemoteCommand(_command=…)`` would sidestep that decision — nothing in Python can
    forbid it, but a call site reaching for a private name is visible in review.
    """

    _command: str

    def __str__(self) -> str:
        return self._command

    @classmethod
    def of(cls, program: str, *args: PathLike) -> "RemoteCommand":
        """A command whose every argument is quoted as data.

        The right choice whenever the command is a program plus arguments, which
        is most of them. ``shlex.quote`` leaves already-safe tokens such as
        ``-c`` and ``%Y`` untouched, so flags can be passed positionally.
        """
        quoted = " ".join(remote_arg(arg) for arg in args)
        return cls(f"{program} {quoted}" if quoted else program)

    @classmethod
    def from_shell_fragment(cls, fragment: str) -> "RemoteCommand":
        """A command that needs shell syntax the caller has assembled itself.

        For redirections, ``||``, loops and ``find`` expressions, which :meth:`of`
        cannot express because quoting them would strip their meaning. The caller
        is asserting it has already passed every interpolated value through
        :func:`remote_arg` or :func:`remote_glob_arg` — grep for this method to
        review every place that claim is made.
        """
        return cls(fragment)
