// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { atomWithStorage, createJSONStorage } from 'jotai/utils';
import { atom } from 'jotai';
import { NumberRange, TabId } from '@blueprintjs/core';
import { Id } from 'react-toastify';
import { TAB_IDS } from '../definitions/BufferSummary';
import { ListStates } from '../definitions/VirtualLists';
import { Signpost } from '../model/Signpost';
import { PerfTabIds } from '../definitions/Performance';
import { ReportFolder, ReportLocation } from '../definitions/Reports';
import { ReportScope } from '../definitions/ReportScope';
import { REPORT_LINKS_STORAGE_KEY } from '../definitions/ReportLinks';
import { getReportId } from '../functions/reportLinks';
import { ReportLink } from '../model/ReportLinks';
import { ColumnKeys, TypedPerfTableRow } from '../definitions/PerfTable';
import { DurationBucket } from '../definitions/PerfDurationHistogram';
import { BufferType } from '../model/BufferType';
import { StackedGroupBy } from '../definitions/StackedPerfTable';
import { SortingOptions } from '../definitions/SortingOptions';
import { DEFAULT_TOP_N_COUNT, TopNAnnotationMode } from '../definitions/TopNAnnotations';
import { MlirServerConnection } from '../definitions/MlirServer';
import { MlirFileResult, MlirLoadedReport } from '../model/MLIRJsonModel';
import { aggregateFileTransferProgress, fileTransferRegistryAtom } from './fileTransferRegistry';

// App state
export const activeToastAtom = atom<Id | null>(null);
export const selectedAddressAtom = atom<number | null>(null);
export const selectedTensorIdAtom = atom<number | null>(null);
export const listStatesAtom = atom<ListStates | null>(null);
export const selectedBufferColourAtom = atom<string | null>(null);
// File transfer registry atoms — defined in store/fileTransferRegistry.ts (see comment there);
// re-exported here so shared atoms remain discoverable via store/app.ts.
export {
    clearAllFileTransferProgress,
    clearFileTransferProgressForSource,
    clearFileTransferProgressForSourceIfInactive,
    clearStaleRemoteSyncOnReconnect,
    fileTransferProgressBySourceAtom,
    fileTransferRegistryAtom,
    getInactiveFileTransferProgress,
    setFileTransferProgressForSource,
} from './fileTransferRegistry';

export const fileTransferProgressAtom = atom((get) => aggregateFileTransferProgress(get(fileTransferRegistryAtom)));
export const showDeallocationReportAtom = atom(false);
export const showHexAtom = atomWithStorage('showHex', false); // Used in Buffers and Operation Details
export const showMemoryRegionsAtom = atomWithStorage('showMemoryRegions', true); // Used in Buffers and Operation Details
export const renderMemoryLayoutAtom = atomWithStorage('renderMemoryLayout', false); // Used in Buffers and Operation Details

// Reports (excluding NPE/MLIR)
export const profilerReportLocationAtom = atom<ReportLocation | null>(null);
export const activeProfilerReportAtom = atom<ReportFolder | null>(null);
export const operationRangeAtom = atom<NumberRange | null>(null);
export const selectedOperationRangeAtom = atom<NumberRange | null>(null);
export const performanceReportLocationAtom = atom<ReportLocation | null>(null);
export const activePerformanceReportAtom = atom<ReportFolder | null>(null);
/**
 * Folder the active performance report occupies on disk, which is what the API's
 * `?name=` parameter addresses a report by. `reportName` cannot stand in: it is the
 * report's own name, so for a synced multihost report it lacks the `_rank<N>`
 * qualifier that tells one rank of a launch from another.
 */
export const activePerformanceReportFolderNameAtom = atom((get) => {
    const activeReport = get(activePerformanceReportAtom);

    return getReportId(activeReport?.syncedName, activeReport?.path);
});
/** True while a report select/mount is awaiting confirmation of the active report. */
export const isActivatingReportAtom = atom(false);
// Persisted memory↔performance report pairs (linked and unlinked). Many-to-many
// by canonical folder id; surfaced as linked/unknown/unlinked badges in pickers.
// Storage key bumped so pre-status / pre-id-scheme entries are discarded (no migration).
export const reportLinksAtom = atomWithStorage<ReportLink[]>(REPORT_LINKS_STORAGE_KEY, []);
export const performanceRangeAtom = atom<NumberRange | null>(null);
export const selectedPerformanceRangeAtom = atom<NumberRange | null>(null);
export const hasClusterDescriptionAtom = atom(false);

// Operations route
export const shouldCollapseAllOperationsAtom = atom(false);
export const operationListFilterAtom = atom('');
export const selectedDeviceOperationsAtom = atom<Set<string>>(new Set<string>());
export const shouldSortByIDAtom = atom<SortingOptions>(SortingOptions.ASCENDING);
export const shouldSortDurationAtom = atom<SortingOptions>(SortingOptions.OFF);

// Operation details route
export const isFullStackTraceAtom = atom(false);

// Operation graph route
// Holds the reports the highlight was switched on for, or null for off. Carrying
// the scope rather than a bare flag makes a stale intent inert on sight: a report
// swap stops it matching in the same render, so no frame can outlive its data
// while the view gets around to clearing the intent. Never persisted, since the
// highlight only reads on a READY perf overlay. #1613
//
// Module scope, so the intent outlives leaving `/graphtree` and coming back — the
// report it names is what invalidates it, not the view's lifetime. The perf
// overlay's own flag is local `useState` and does not survive that trip; the two
// switches deliberately differ until #1903 decides whether they should agree.
export const criticalPathScopeAtom = atom<ReportScope | null>(null);

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
// Selected duration buckets, keyed by each bucket's lower bound in microseconds. bucketIndex
// is an offset from the dataset's lowest decade, so it would shift meaning as rows change.
export const durationBucketFilterListAtom = atom<DurationBucket['minUs'][]>([]);
export const mergeDevicesAtom = atom<boolean>(true);
export const tracingModeAtom = atom<boolean>(false);
export const stackedGroupByAtom = atom<StackedGroupBy>(StackedGroupBy.OP);
// Valid only while the modal tensor drawer is open — the backdrop blocks perf-tab switching,
// so a selection can't leak across reports. Cleared with chip filters on active-report change
// (useResetPerfTableSessionState / Performance.tsx) and on drawer close / row removal /
// unsynced reports (PerfTable.tsx).
export const selectedPerfRowIdAtom = atom<number | null>(null);
// Persisted globally (atomWithStorage) by design: a user's preferred column layout follows them across reports
export const hiddenPerfTableColumnsAtom = atomWithStorage<ColumnKeys[]>('hiddenPerfTableColumns', []);

// NPE
export const activeNpeOpTraceAtom = atom<string | null>(null);
export const altCongestionColorsAtom = atomWithStorage('altCongestionColors', false);

// MLIR
// Session-loaded MLIR reports (0–2). Index 0 is persisted/nav-active.
export const mlirLoadedReportsAtom = atom<MlirLoadedReport[]>([]);
// Derived for nav, restore, and FileInput label. Writing replaces the list with
// a name-only primary (reload fetch) or clears it.
export const activeMlirJsonAtom = atom(
    (get) => get(mlirLoadedReportsAtom)[0]?.name ?? null,
    (get, set, name: string | null) => {
        if (name === null) {
            set(mlirLoadedReportsAtom, []);
            return;
        }
        const current = get(mlirLoadedReportsAtom);
        // Keep in-memory primary data and split peers when re-asserting the same
        // active name (restore used to replace the list with `{ data: null }`).
        if (current[0]?.name === name && current[0]?.data) {
            return;
        }
        set(mlirLoadedReportsAtom, [{ name, data: null }]);
    },
);
export const mlirFileResultsAtom = atom<MlirFileResult[] | null>(null);
export const mlirFileResultsOpenAtom = atom(false);
export const mlirRetryFilesAtom = atom<File[] | null>(null);
// Bumped on each two-file View so the MLIR route can auto-open split again
// after the user previously dismissed it for the same peer.
export const mlirSplitViewEpochAtom = atom(0);
export const mlirServersAtom = atomWithStorage<MlirServerConnection[]>('mlirServers', []);
export const selectedMlirServerAtom = atomWithStorage<MlirServerConnection | null>('selectedMlirServer', null);
export const mlirNodeDetailsCollapsedAtom = atomWithStorage<{ attrs: boolean; inputs: boolean; outputs: boolean }>(
    'mlirNodeDetailsCollapsed',
    { attrs: false, inputs: true, outputs: true },
);
// Session-scoped so the view opens uncluttered after a browser restart —
// deliberately different lifetime from the neighbouring `mlirNodeDetailsCollapsed`
// (which is a stable structural preference that survives sessions).
export const mlirNodeBodyTogglesAtom = atomWithStorage<{ location: boolean; shapes: boolean }>(
    'mlirNodeBodyToggles',
    { location: false, shapes: false },
    createJSONStorage(() => sessionStorage),
);
