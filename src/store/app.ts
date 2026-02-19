// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { atomWithStorage } from 'jotai/utils';
import { atom } from 'jotai';
import { NumberRange, TabId } from '@blueprintjs/core';
import { Id } from 'react-toastify';
import { FileProgress, FileStatus } from '../model/APIData';
import { TAB_IDS } from '../definitions/BufferSummary';
import { ScrollPosition } from '../definitions/ScrollPositions';
import { Signpost } from '../functions/perfFunctions';
import { PerfTabIds } from '../definitions/Performance';
import { ReportFolder, ReportLocation } from '../definitions/Reports';
import { TypedPerfTableRow } from '../definitions/PerfTable';
import { BufferType } from '../model/BufferType';
import { StackedGroupBy } from '../definitions/StackedPerfTable';

// App state
export const activeToastAtom = atom<Id | null>(null);
export const selectedAddressAtom = atom<number | null>(null);
export const selectedTensorIdAtom = atom<number | null>(null);
export const scrollPositionsAtom = atom<ScrollPosition | null>(null);
export const fileTransferProgressAtom = atom<FileProgress>({
    currentFileName: '',
    numberOfFiles: 0,
    percentOfCurrent: 0,
    finishedFiles: 0,
    status: FileStatus.INACTIVE,
}); // This atom stores the file transfer progress data in localStorage (or sessionStorage)
export const showDeallocationReportAtom = atom<boolean>(false);
export const showHexAtom = atomWithStorage<boolean>('showHex', false);
export const showMemoryRegionsAtom = atomWithStorage<boolean>('showMemoryRegions', true);
export const renderMemoryLayoutAtom = atomWithStorage<boolean>('renderMemoryLayout', false);

// Reports
export const profilerReportLocationAtom = atom<ReportLocation | null>(null);
export const activeProfilerReportAtom = atom<ReportFolder | null>(null);
export const operationRangeAtom = atom<NumberRange | null>(null);
export const selectedOperationRangeAtom = atom<NumberRange | null>(null);
export const performanceReportLocationAtom = atom<ReportLocation | null>(null);
export const activePerformanceReportAtom = atom<ReportFolder | null>(null);
export const performanceRangeAtom = atom<NumberRange | null>(null);
export const selectedPerformanceRangeAtom = atom<NumberRange | null>(null);
export const activeNpeOpTraceAtom = atom<string | null>(null);
export const hasClusterDescriptionAtom = atom<boolean>(false);

// Operations route
export const shouldCollapseAllOperationsAtom = atom(false);
export const operationListFilterAtom = atom('');

// Operation details route
export const isFullStackTraceAtom = atom(false);

// Tensors route
export const shouldCollapseAllTensorsAtom = atom(false);
export const tensorBufferTypeFiltersAtom = atom<(BufferType | null)[]>([]);

// Buffers route
export const selectedBufferSummaryTabAtom = atom<TAB_IDS>(TAB_IDS.L1);
export const showBufferSummaryZoomedAtom = atomWithStorage<boolean>('showBufferSummary', false);

// Performance route
export const comparisonPerformanceReportListAtom = atom<string[] | null>(null);
export const perfSelectedTabAtom = atom<TabId>(PerfTabIds.TABLE);
export const isStackedViewAtom = atom(false);
export const filterBySignpostAtom = atom<(Signpost | null)[]>([null, null]);
export const hideHostOpsAtom = atom<boolean>(true);
export const mathFilterListAtom = atom<TypedPerfTableRow['math_fidelity'][]>([]);
export const rawOpCodeFilterListAtom = atom<TypedPerfTableRow['raw_op_code'][]>([]);
export const bufferTypeFilterListAtom = atom<TypedPerfTableRow['buffer_type'][]>([]);
export const mergeDevicesAtom = atom<boolean>(true);
export const tracingModeAtom = atom<boolean>(false);
export const stackedGroupByAtom = atom<StackedGroupBy>(StackedGroupBy.OP);

// NPE
export const altCongestionColorsAtom = atomWithStorage<boolean>('altCongestionColorsAtom', false);
