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

// Keep in sync with `RemoteConnectionFailureReason` in backend/ttnn_visualizer/enums.py;
// test_remote_connection_reason.py pins the two together.
export enum RemoteConnectionFailureReason {
    AUTH_FAILED = 'auth_failed',
    HOST_KEY_REJECTED = 'host_key_rejected',
    UNREACHABLE = 'unreachable',
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
    /**
     * Why the connection failed, so nothing has to parse `message`, which is written for
     * people and names the host. Absent for a failure that fits no class.
     */
    reason?: RemoteConnectionFailureReason | null;
}
