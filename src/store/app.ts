// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { atomWithStorage } from 'jotai/utils';
import { atom } from 'jotai';
import { NumberRange } from '@blueprintjs/core';
import { FileProgress, FileStatus } from '../model/APIData';
import { DEFAULT_DEVICE_ID } from '../definitions/Devices';
import { TAB_IDS } from '../definitions/BufferSummary';

export const reportLocationAtom = atom<'local' | 'remote' | null>(null);
export const activeReportAtom = atom<string | null>(null);
export const activePerformanceTraceAtom = atom<string | null>(null);
export const activeNpeOpTraceAtom = atom<string | null>(null);
export const showHexAtom = atomWithStorage<boolean>('showHex', false);
export const selectedBufferSummaryTabAtom = atomWithStorage<TAB_IDS>('selectedBufferSummaryTab', TAB_IDS.L1);
export const showBufferSummaryZoomedAtom = atomWithStorage<boolean>('showBufferSummary', false);

export const isFullStackTraceAtom = atom(false);
export const shouldCollapseAllOperationsAtom = atom(false);
export const expandedOperationsAtom = atom<number[]>([]);
export const expandedTensorsAtom = atom<number[]>([]);
export const activeToastAtom = atom<number | null>(null);
export const selectedAddressAtom = atom<number | null>(null);
export const selectedTensorAtom = atom<number | null>(null);

export const operationRangeAtom = atom<NumberRange | null>(null);
export const selectedOperationRangeAtom = atom<NumberRange | null>(null);
export const performanceRangeAtom = atom<NumberRange | null>(null);
export const selectedPerformanceRangeAtom = atom<NumberRange | null>(null);

// This atom stores the file transfer progress data in localStorage (or sessionStorage)
export const fileTransferProgressAtom = atom<FileProgress>({
    currentFileName: '',
    numberOfFiles: 0,
    percentOfCurrent: 0,
    finishedFiles: 0,
    status: FileStatus.INACTIVE,
});

export const selectedDeviceAtom = atom<number | null>(DEFAULT_DEVICE_ID); // Assumes device_id always uses a zero based index (NOT REALLY USED AT THE MOMENT)
export const renderMemoryLayoutAtom = atom<boolean>(false);
