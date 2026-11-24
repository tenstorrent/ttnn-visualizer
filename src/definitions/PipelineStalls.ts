// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// The enums mirror `backend/ttnn_visualizer/pipeline_stalls.py`; a backend parity test holds them. The server
// words what fills a part of the stalls, so no capture flag is copied here.
export enum PipelineThread {
    T0 = 't0',
    T1 = 't1',
    T2 = 't2',
}

export enum PipelineThreadRole {
    UNPACK = 'unpack',
    MATH = 'math',
    PACK = 'pack',
}

export enum CbWaitZone {
    WAIT_FRONT = 'cb_wait_front',
    RESERVE_BACK = 'cb_reserve_back',
}

export enum StallSource {
    HARDWARE_COUNTER = 'hardware_counter',
    INSTRUMENTATION = 'instrumentation',
}

export enum StallState {
    FILLED = 'filled',
    NOT_CAPTURED = 'not_captured',
    NO_VALUE = 'no_value',
    IGNORED = 'ignored',
}

export const PIPELINE_THREAD_LABELS: Record<PipelineThread, string> = {
    [PipelineThread.T0]: 'T0',
    [PipelineThread.T1]: 'T1',
    [PipelineThread.T2]: 'T2',
};

export const PIPELINE_THREAD_ROLE_LABELS: Record<PipelineThreadRole, string> = {
    [PipelineThreadRole.UNPACK]: 'Unpack',
    [PipelineThreadRole.MATH]: 'Math',
    [PipelineThreadRole.PACK]: 'Pack',
};

interface CbWaitZoneLabel {
    thread: PipelineThread;
    waitingFor: string;
}

export const CB_WAIT_ZONE_LABELS: Record<CbWaitZone, CbWaitZoneLabel> = {
    [CbWaitZone.WAIT_FRONT]: { thread: PipelineThread.T0, waitingFor: 'waiting for input' },
    [CbWaitZone.RESERVE_BACK]: { thread: PipelineThread.T2, waitingFor: 'waiting for output space' },
};

export const STALL_SOURCE_LABELS: Record<StallSource, string> = {
    [StallSource.HARDWARE_COUNTER]: 'hardware counter',
    [StallSource.INSTRUMENTATION]: 'instrumentation',
};
