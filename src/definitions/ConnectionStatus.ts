// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum ConnectionTestStates {
    IDLE,
    PROGRESS,
    FAILED,
    OK,
}

export interface ConnectionStatus {
    status: ConnectionTestStates;
    message: string;
}
