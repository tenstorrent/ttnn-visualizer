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


class StackSourceOrigin(str, enum.Enum):
    DATABASE = "database"
    PATH = "path"
    REMAPPED = "remapped"


class SyncMethod(str, enum.Enum):
    SFTP = "sftp"
    SCP = "scp"
