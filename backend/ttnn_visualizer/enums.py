# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import enum


class ConnectionTestStates(enum.Enum):
    IDLE = 0
    PROGRESS = 1
    FAILED = 2
    OK = 3
