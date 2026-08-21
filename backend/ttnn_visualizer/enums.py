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


# Keep in sync with src/definitions/ConnectionStatus.ts
class HostKeyIssue(str, enum.Enum):
    """Why OpenSSH refused a host key, which decides whether trusting it is offered.

    Both cases reach us as ``Host key verification failed.``, but only one of them is
    a first connection. ``CHANGED`` may be a man-in-the-middle or merely a rebuilt
    host, and either way the user has to resolve it themselves — so the two must not
    share a remedy.
    """

    UNKNOWN = "unknown"
    CHANGED = "changed"


class StackSourceOrigin(str, enum.Enum):
    DATABASE = "database"
    PATH = "path"
    REMAPPED = "remapped"


class SyncMethod(str, enum.Enum):
    SFTP = "sftp"
    SCP = "scp"
