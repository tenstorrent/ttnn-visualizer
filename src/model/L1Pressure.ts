// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Buffer, BuffersByOperation, DeviceInfo } from './APIData';

export interface L1PressureMetrics {
    fullnessPercent: number;
    freeSegments: number;
    largestFreeBytes: number;
    largestFreePercent: number;
}

export enum L1PressureStatus {
    Loading = 'loading',
    Unavailable = 'unavailable',
    Ready = 'ready',
}

// Discriminated result so consumers can reserve the L1 column while inputs are still resolving
// (avoiding a mid-render layout jump) and hide it only when the data is genuinely unavailable.
export interface L1PressureResult {
    status: L1PressureStatus;
    data: Map<number, L1PressureMetrics> | null;
}

export interface L1PressureBuildParams {
    hasProfilerReport: boolean;
    isError: boolean;
    isLoading: boolean;
    buffersByOperation: BuffersByOperation[] | undefined;
    devices: DeviceInfo[] | undefined;
    l1SmallBuffers: Buffer[] | undefined;
    l1Start: number;
    l1End: number;
}
