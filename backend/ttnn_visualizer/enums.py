# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import enum


# Keep in sync with src/definitions/ConnectionStatus.ts
class ConnectionTestStates(enum.Enum):
    IDLE = 0
    PROGRESS = 1
    FAILED = 2
    OK = 3
    WARNING = 4


# Keep in sync with src/definitions/HostKey.ts
class HostKeyIssue(str, enum.Enum):
    """Why OpenSSH refused a host key, which decides whether trusting it is offered.

    Every case reaches us as ``Host key verification failed.``, but only one of them is
    a first connection. ``CHANGED`` may be a man-in-the-middle or merely a rebuilt
    host, and either way the user has to resolve it themselves — so the two must not
    share a remedy. ``REVOKED`` is decided by us rather than read off OpenSSH's stderr:
    it means the key the host is offering right now is one ``known_hosts`` blacklists
    with ``@revoked``, which is neither a first connection nor a key that merely changed,
    and is the one case with no remedy to offer at all.

    Kept in step with ``src/definitions/HostKey.ts``, which is pinned against this by
    ``test_host_key_frontend_parity.py``.
    """

    UNKNOWN = "unknown"
    CHANGED = "changed"
    REVOKED = "revoked"


# Keep in sync with src/definitions/ConnectionStatus.ts
class RemoteConnectionFailureReason(str, enum.Enum):
    """Why a remote connection test failed, for a status line to carry without its message.

    Messages are written for people and carry the host, so nothing reading a result may
    parse them; this is the machine-readable half. The connection test's own timeout
    counts as ``UNREACHABLE``, since the host never answered, and so does a connection
    lost during the SSH test itself or while a path was searched. A search that times out
    carries no reason.

    ``REPORT_PATH_FAILED`` is set only where the backend knows the configured path is the
    problem: missing, not a directory, or unreadable. Absent means the failure has no
    class, an unexpected SSH error or a search that never settled its path included, so a
    failure nobody classified is never counted as a misconfigured path.
    """

    AUTH_FAILED = "auth_failed"
    HOST_KEY_REJECTED = "host_key_rejected"
    UNREACHABLE = "unreachable"
    REPORT_PATH_FAILED = "report_path_failed"


class StackSourceOrigin(str, enum.Enum):
    DATABASE = "database"
    PATH = "path"
    REMAPPED = "remapped"


class SyncMethod(str, enum.Enum):
    SFTP = "sftp"
    SCP = "scp"
