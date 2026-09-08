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


class StackSourceOrigin(str, enum.Enum):
    DATABASE = "database"
    PATH = "path"
    REMAPPED = "remapped"


class SyncMethod(str, enum.Enum):
    SFTP = "sftp"
    SCP = "scp"
