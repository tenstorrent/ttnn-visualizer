// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { HostKeyStatus } from '../model/HostKey';

export enum ConnectionTestStates {
    IDLE,
    PROGRESS,
    FAILED,
    OK,
    WARNING,
}

export interface ConnectionStatus {
    status: ConnectionTestStates;
    message: string;
    detail?: string;
    /**
     * Set only on the line reporting a host-key failure, which is why this rides here
     * rather than being a sixth `ConnectionTestStates`: the status is still `FAILED`, so
     * the save gate and every exhaustive icon/intent map stay as they are.
     */
    hostKey?: HostKeyStatus | null;
}
