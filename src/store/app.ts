// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { atomWithStorage } from 'jotai/utils';
import { atom } from 'jotai';
import { NumberRange, TabId } from '@blueprintjs/core';
import { Id } from 'react-toastify';
import { FileProgress, FileStatus } from '../model/APIData';
import { TAB_IDS } from '../definitions/BufferSummary';
import { ListStates } from '../definitions/VirtualLists';
import { Signpost } from '../functions/perfFunctions';
import { PerfTabIds } from '../definitions/Performance';
import { ReportFolder, ReportLocation } from '../definitions/Reports';
import { ReportLink } from '../functions/reportLinks';
import { ColumnKeys, TypedPerfTableRow } from '../definitions/PerfTable';
import { BufferType } from '../model/BufferType';
import { StackedGroupBy } from '../definitions/StackedPerfTable';
import { SortingOptions } from '../definitions/SortingOptions';
import { DEFAULT_TOP_N_COUNT, TopNAnnotationMode } from '../functions/topNAnnotations';
import { MlirServerConnection } from '../definitions/MlirServer';
import { GraphBundle } from '../model/MLIRJsonModel';

// App state
export const activeToastAtom = atom<Id | null>(null);
export const selectedAddressAtom = atom<number | null>(null);
export const selectedTensorIdAtom = atom<number | null>(null);
export const listStatesAtom = atom<ListStates | null>(null);
export const selectedBufferColourAtom = atom<string | null>(null);
/** Fresh inactive progress snapshot. Always call this for resets — do not reuse a shared object or spread `previous`, or stale `numberOfFiles` / byte fields can linger. */
export function getInactiveFileTransferProgress(): FileProgress {
    return {
        currentFileName: '',
        numberOfFiles: 0,
        percentOfCurrent: 0,
        finishedFiles: 0,
        status: FileStatus.INACTIVE,
    };
}

export const fileTransferProgressAtom = atom<FileProgress>(getInactiveFileTransferProgress());
export const showDeallocationReportAtom = atom(false);
export const showHexAtom = atomWithStorage('showHex', false); // Used in Buffers and Operation Details
export const showMemoryRegionsAtom = atomWithStorage('showMemoryRegions', true); // Used in Buffers and Operation Details
export const renderMemoryLayoutAtom = atomWithStorage('renderMemoryLayout', false); // Used in Buffers and Operation Details

// Reports
export const profilerReportLocationAtom = atom<ReportLocation | null>(null);
export const activeProfilerReportAtom = atom<ReportFolder | null>(null);
export const operationRangeAtom = atom<NumberRange | null>(null);
export const selectedOperationRangeAtom = atom<NumberRange | null>(null);
export const performanceReportLocationAtom = atom<ReportLocation | null>(null);
export const activePerformanceReportAtom = atom<ReportFolder | null>(null);
// Persisted memory<->performance report pairs observed to link successfully. Many-to-many
// by design; surfaced as badges against the active report in the report selection lists.
export const successfulReportLinksAtom = atomWithStorage<ReportLink[]>('successfulReportLinks', []);
export const performanceRangeAtom = atom<NumberRange | null>(null);
export const selectedPerformanceRangeAtom = atom<NumberRange | null>(null);
export const activeNpeOpTraceAtom = atom<string | null>(null);
export const activeMlirJsonAtom = atom<string | null>(null);
export const activeMlirDataAtom = atom<GraphBundle | null>(null);
export const mlirServersAtom = atomWithStorage<MlirServerConnection[]>('mlirServers', []);
export const selectedMlirServerAtom = atomWithStorage<MlirServerConnection | null>('selectedMlirServer', null);
export const mlirNodeDetailsCollapsedAtom = atomWithStorage<{ attrs: boolean; inputs: boolean; outputs: boolean }>(
    'mlirNodeDetailsCollapsed',
    { attrs: false, inputs: true, outputs: true },
);
export const hasClusterDescriptionAtom = atom(false);

// Operations route
export const shouldCollapseAllOperationsAtom = atom(false);
export const operationListFilterAtom = atom('');
export const selectedDeviceOperationsAtom = atom<Set<string>>(new Set<string>());
export const shouldSortByIDAtom = atom<SortingOptions>(SortingOptions.ASCENDING);
export const shouldSortDurationAtom = atom<SortingOptions>(SortingOptions.OFF);

// Operation details route
export const isFullStackTraceAtom = atom(false);

// Tensors route
export const shouldCollapseAllTensorsAtom = atom(false);
export const tensorBufferTypeFiltersAtom = atom<(BufferType | null)[]>([]);
export const tensorListFilterAtom = atom('');
export const showHighConsumerTensorsAtom = atom(false);
export const showLateDeallocatedTensorsAtom = atom(false);
export const shouldSortBySizeAtom = atom<SortingOptions>(SortingOptions.OFF);

// Buffers route
export const selectedBufferSummaryTabAtom = atom<TAB_IDS>(TAB_IDS.L1);
export const showBufferSummaryZoomedAtom = atomWithStorage('showBufferSummary', false);
// Top-N op annotation on the buffer summary chart (#1517). Mode and N persist
// across sessions because they're stable user preferences; the on/off toggle
// stays in-memory and persists for the lifetime of the loaded session — the
// per-mode availability machinery in the controls grays the switch out when
// the active mode goes UNAVAILABLE / UNLINKED / NO_DATA on report change, so
// a previously-enabled toggle never produces ghost annotations.
export const topNAnnotationEnabledAtom = atom<boolean>(false);
export const topNAnnotationModeAtom = atomWithStorage<TopNAnnotationMode>(
    'topNAnnotationMode',
    TopNAnnotationMode.PERF_TIME,
);
export const topNAnnotationCountAtom = atomWithStorage<number>('topNAnnotationCount', DEFAULT_TOP_N_COUNT);

// Performance route
export const comparisonPerformanceReportListAtom = atom<string[] | null>(null);
export const perfSelectedTabAtom = atom<TabId>(PerfTabIds.TABLE);
export const isStackedViewAtom = atom(false);
export const filterBySignpostAtom = atom<(Signpost | null)[]>([null, null]);
export const hideHostOpsAtom = atom(true);
export const mathFilterListAtom = atom<TypedPerfTableRow['math_fidelity'][]>([]);
export const rawOpCodeFilterListAtom = atom<TypedPerfTableRow['raw_op_code'][]>([]);
export const bufferTypeFilterListAtom = atom<TypedPerfTableRow['buffer_type'][]>([]);
export const layoutFilterListAtom = atom<TypedPerfTableRow['layout'][]>([]);
export const mergeDevicesAtom = atom<boolean>(true);
export const tracingModeAtom = atom<boolean>(false);
export const stackedGroupByAtom = atom<StackedGroupBy>(StackedGroupBy.OP);
// Valid only while the modal tensor drawer is open — the backdrop blocks perf-tab switching,
// so a selection can't leak across reports. Cleared on active-report change (Performance.tsx)
// and on drawer close / row removal / unsynced reports (PerfTable.tsx).
export const selectedPerfRowIdAtom = atom<number | null>(null);
// Persisted globally (atomWithStorage) by design: a user's preferred column layout follows them across reports
export const hiddenPerfTableColumnsAtom = atomWithStorage<ColumnKeys[]>('hiddenPerfTableColumns', []);

// NPE
export const altCongestionColorsAtom = atomWithStorage('altCongestionColors', false);
