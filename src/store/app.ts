// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { atomWithStorage } from 'jotai/utils';
import { atom } from 'jotai';
import { NumberRange, TabId } from '@blueprintjs/core';
import { Id } from 'react-toastify';
import { FileProgress, FileStatus } from '../model/APIData';
import { DEFAULT_DEVICE_ID } from '../definitions/Devices';
import { TAB_IDS } from '../definitions/BufferSummary';
import { ScrollPosition } from '../definitions/ScrollPositions';
import { Signpost } from '../functions/perfFunctions';
import { PerfTabIds } from '../definitions/Performance';
import { ReportFolder, ReportLocation } from '../definitions/Reports';
import { TableFilter, TypedPerfTableRow } from '../definitions/PerfTable';
import { BufferType } from '../model/BufferType';

// Unsorted
export const profilerReportLocationAtom = atom<ReportLocation | null>(null);
export const performanceReportLocationAtom = atom<ReportLocation | null>(null);
export const activeProfilerReportAtom = atom<ReportFolder | null>(null);
export const activePerformanceReportAtom = atom<ReportFolder | null>(null);
export const activeNpeOpTraceAtom = atom<string | null>(null);
export const hasClusterDescriptionAtom = atom<boolean>(false);

export const activeToastAtom = atom<Id | null>(null);
export const selectedAddressAtom = atom<number | null>(null);
export const selectedTensorAtom = atom<number | null>(null);

export const operationRangeAtom = atom<NumberRange | null>(null);
export const selectedOperationRangeAtom = atom<NumberRange | null>(null);
export const performanceRangeAtom = atom<NumberRange | null>(null);
export const selectedPerformanceRangeAtom = atom<NumberRange | null>(null);

export const scrollPositionsAtom = atom<ScrollPosition | null>(null);

export const showDeallocationReportAtom = atom<boolean>(false);

// This atom stores the file transfer progress data in localStorage (or sessionStorage)
export const fileTransferProgressAtom = atom<FileProgress>({
    currentFileName: '',
    numberOfFiles: 0,
    percentOfCurrent: 0,
    finishedFiles: 0,
    status: FileStatus.INACTIVE,
});

// Operations route
export const shouldCollapseAllOperationsAtom = atom(false);
export const operationListFilterAtom = atom('');

// Operation details route
export const isFullStackTraceAtom = atom(false);

// Tensors route
export const shouldCollapseAllTensorsAtom = atom(false);
export const tensorBufferTypeFiltersAtom = atom<(BufferType | null)[]>([]);

// Buffers route
export const showHexAtom = atomWithStorage<boolean>('showHex', false);
export const showMemoryRegionsAtom = atomWithStorage<boolean>('showMemoryRegions', true);
export const selectedBufferSummaryTabAtom = atomWithStorage<TAB_IDS>('selectedBufferSummaryTab', TAB_IDS.L1);
export const showBufferSummaryZoomedAtom = atomWithStorage<boolean>('showBufferSummary', false);

// Performance route
export const comparisonPerformanceReportListAtom = atom<string[] | null>(null);
export const perfSelectedTabAtom = atom<TabId>(PerfTabIds.TABLE);
export const perfTableFiltersAtom = atom<TableFilter | null>(null);
export const isStackedViewAtom = atom(false);
export const stackByIn0Atom = atom(true);
export const filterBySignpostAtom = atom<(Signpost | null)[]>([null, null]);
export const selectedDeviceAtom = atom<number | null>(DEFAULT_DEVICE_ID); // Assumes device_id always uses a zero based index (NOT REALLY USED AT THE MOMENT)
export const renderMemoryLayoutAtom = atom<boolean>(false);
export const hideHostOpsAtom = atom<boolean>(true);
export const mathFilterListAtom = atom<TypedPerfTableRow['math_fidelity'][]>([]);
export const rawOpCodeFilterListAtom = atom<TypedPerfTableRow['raw_op_code'][]>([]);
export const bufferTypeFilterListAtom = atom<TypedPerfTableRow['buffer_type'][]>([]);
export const mergeDevicesAtom = atom<boolean>(true);

// NPE
export const altCongestionColorsAtom = atomWithStorage<boolean>('altCongestionColorsAtom', false);
