// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import {
    activePerformanceReportAtom,
    topNAnnotationCountAtom,
    topNAnnotationEnabledAtom,
    topNAnnotationModeAtom,
} from '../store/app';
import {
    RankedAnnotation,
    TopNAnnotationMode,
    TopNAnnotationStatus,
    isPerfMode,
    selectTopNAnnotations,
} from '../functions/topNAnnotations';
import { OpPerfAggregate, PerfOverlaySource, aggregatePerfByOp } from '../functions/perfOverlay';
import { L1PressureMetrics, L1PressureStatus } from '../functions/l1Pressure';
import { useGetDeviceOperationListPerf, useL1PressureByOperation, usePerformanceReport } from './useAPI';

export interface UseTopNAnnotationAvailabilityParams {
    /**
     * When `true` the L1 fullness mode is forced `UNAVAILABLE`. DRAM tab sets
     * this — fullness is computed against the L1 budget and doesn't carry
     * meaning in DRAM space.
     */
    forceL1Unavailable?: boolean;
}

// `parseFloat('')` and friends return `NaN`; collapse those to `null` so the
// downstream aggregator can rely on `null` meaning "no data".
const parseFiniteOrNull = (raw: string | null | undefined): number | null => {
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
};

export interface UseTopNAnnotationAvailabilityResult {
    /**
     * Per-mode availability. Each mode is resolved against its own source
     * pipeline — perf modes share a perf-report-loaded / linked check but
     * resolve `NO_DATA` independently when the underlying column is empty
     * (e.g. perf report has `device_time` but no `op_to_op_gap` values).
     */
    statusByMode: Record<TopNAnnotationMode, TopNAnnotationStatus>;
    perfAggregatesByOpId: Map<number, OpPerfAggregate>;
    l1PressureByOpId: Map<number, L1PressureMetrics> | null;
}

/**
 * Resolves the per-mode availability of each top-N mode plus the underlying
 * data maps.
 *
 * The toggle state persists for the lifetime of the loaded session — we
 * intentionally do not reset on report change. The control's availability
 * machinery already grays out the switch when the active mode goes
 * `UNAVAILABLE` / `UNLINKED` / `NO_DATA`, so a stale-but-on toggle never
 * renders ghost annotations.
 */
export const useTopNAnnotationAvailability = ({
    forceL1Unavailable = false,
}: UseTopNAnnotationAvailabilityParams = {}): UseTopNAnnotationAvailabilityResult => {
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    const { data: perfReport } = usePerformanceReport(activePerformanceReport?.reportName ?? null);
    // Lock-step id-space match against the profiler op list. Returns [] when
    // the perf report doesn't line up — that's the `UNLINKED` signal below.
    const matchedPerfOps = useGetDeviceOperationListPerf();
    const l1Pressure = useL1PressureByOperation();

    // Source overlay rows from the matched op list so the row `id` is the
    // *profiler* op id (what the buffer summary keys on), not the perf-table
    // row index — matches GraphView's overlay wiring.
    //
    // We pull the richer metric fields here (op-to-op gap, DRAM %, FLOPS %)
    // because top-N supports more than kernel duration. The graph overlay
    // path in `GraphView.tsx` continues to project just `device_time`; the
    // optional fields are ignored by `aggregatePerfByOp` when absent.
    const perfAggregatesByOpId = useMemo<Map<number, OpPerfAggregate>>(() => {
        if (matchedPerfOps.length === 0) {
            return new Map();
        }
        const overlayRows: PerfOverlaySource[] = matchedPerfOps.flatMap((deviceOperation) => {
            const { perfData } = deviceOperation;
            if (perfData?.device_time === undefined) {
                return [];
            }
            const parsedDeviceTime = parseFloat(perfData.device_time);
            return [
                {
                    id: deviceOperation.id,
                    device_time: Number.isFinite(parsedDeviceTime) ? parsedDeviceTime : null,
                    op_to_op_gap: parseFiniteOrNull(perfData.op_to_op_gap),
                    dram_percent: parseFiniteOrNull(perfData.dram_percent),
                    flops_percent: parseFiniteOrNull(perfData.flops_percent),
                },
            ];
        });
        return aggregatePerfByOp(overlayRows);
    }, [matchedPerfOps]);

    const l1PressureByOpId: Map<number, L1PressureMetrics> | null = l1Pressure.data;

    const isPerfReportLoaded = Boolean(perfReport?.report?.length);

    const statusByMode: Record<TopNAnnotationMode, TopNAnnotationStatus> = useMemo(() => {
        // Resolve the perf-report-side preamble (UNAVAILABLE / UNLINKED) once;
        // every perf mode shares it. Only the per-metric NO_DATA check below
        // varies between perf modes.
        let perfPreamble: TopNAnnotationStatus | null = null;
        if (!isPerfReportLoaded) {
            perfPreamble = TopNAnnotationStatus.UNAVAILABLE;
        } else if (perfAggregatesByOpId.size === 0) {
            perfPreamble = TopNAnnotationStatus.UNLINKED;
        }

        // Walk the aggregate map once and remember which perf metrics had at
        // least one positive contributing row. Anything without a hit gets
        // `NO_DATA` even though the report-level preamble says READY — that
        // way the dropdown can gray out (e.g.) op-to-op gap when the column
        // is empty without misrepresenting it as "no report loaded".
        let hasKernelDuration = false;
        let hasOpToOpGap = false;
        let hasDramPercent = false;
        let hasFlopsPercent = false;
        if (perfPreamble === null) {
            for (const aggregate of perfAggregatesByOpId.values()) {
                if (aggregate.deviceTimeNs > 0) {
                    hasKernelDuration = true;
                }
                if (aggregate.opToOpGapNs !== null && aggregate.opToOpGapNs > 0) {
                    hasOpToOpGap = true;
                }
                if (aggregate.dramPercent !== null && aggregate.dramPercent > 0) {
                    hasDramPercent = true;
                }
                if (aggregate.flopsPercent !== null && aggregate.flopsPercent > 0) {
                    hasFlopsPercent = true;
                }
                if (hasKernelDuration && hasOpToOpGap && hasDramPercent && hasFlopsPercent) {
                    break;
                }
            }
        }

        const resolvePerf = (hasMetric: boolean): TopNAnnotationStatus =>
            perfPreamble ?? (hasMetric ? TopNAnnotationStatus.READY : TopNAnnotationStatus.NO_DATA);

        let l1Resolved: TopNAnnotationStatus;
        if (forceL1Unavailable) {
            l1Resolved = TopNAnnotationStatus.UNAVAILABLE;
        } else if (l1Pressure.status !== L1PressureStatus.Ready || !l1PressureByOpId || l1PressureByOpId.size === 0) {
            l1Resolved = TopNAnnotationStatus.UNAVAILABLE;
        } else {
            l1Resolved = TopNAnnotationStatus.READY;
        }

        return {
            [TopNAnnotationMode.PERF_TIME]: resolvePerf(hasKernelDuration),
            [TopNAnnotationMode.PERF_OP_TO_OP_GAP]: resolvePerf(hasOpToOpGap),
            [TopNAnnotationMode.PERF_DRAM_PERCENT]: resolvePerf(hasDramPercent),
            [TopNAnnotationMode.PERF_FLOPS_PERCENT]: resolvePerf(hasFlopsPercent),
            [TopNAnnotationMode.L1_FULLNESS]: l1Resolved,
        };
    }, [isPerfReportLoaded, perfAggregatesByOpId, forceL1Unavailable, l1Pressure.status, l1PressureByOpId]);

    return { statusByMode, perfAggregatesByOpId, l1PressureByOpId };
};

export interface UseTopNAnnotationsParams extends UseTopNAnnotationAvailabilityParams {
    /**
     * Ops currently rendered in the buffer-summary virtualized list. Annotations
     * are restricted to this slice so the rail + badges line up with the
     * visible row positions — the DRAM tab's zoom segmentation can narrow this
     * set to a subrange of the full op list.
     */
    operations: readonly { id: number }[];
}

export interface UseTopNAnnotationsResult extends UseTopNAnnotationAvailabilityResult {
    /** Empty map when disabled, the selected mode isn't READY, or no source data. */
    annotationsByOpId: Map<number, RankedAnnotation>;
}

/**
 * Renderer-facing hook: availability + the computed annotation map for the
 * current mode/count/enabled state. Empty map when the feature is off or the
 * selected mode isn't ready.
 */
export const useTopNAnnotations = ({
    operations,
    forceL1Unavailable = false,
}: UseTopNAnnotationsParams): UseTopNAnnotationsResult => {
    const availability = useTopNAnnotationAvailability({ forceL1Unavailable });
    const enabled = useAtomValue(topNAnnotationEnabledAtom);
    const mode = useAtomValue(topNAnnotationModeAtom);
    const count = useAtomValue(topNAnnotationCountAtom);

    const activeStatus = availability.statusByMode[mode];

    const annotationsByOpId = useMemo<Map<number, RankedAnnotation>>(() => {
        if (!enabled || activeStatus !== TopNAnnotationStatus.READY) {
            return new Map();
        }
        return selectTopNAnnotations({
            mode,
            n: count,
            operations,
            perfAggregatesByOpId: isPerfMode(mode) ? availability.perfAggregatesByOpId : undefined,
            l1PressureByOpId:
                mode === TopNAnnotationMode.L1_FULLNESS && availability.l1PressureByOpId
                    ? availability.l1PressureByOpId
                    : undefined,
        });
    }, [
        enabled,
        activeStatus,
        mode,
        count,
        operations,
        availability.perfAggregatesByOpId,
        availability.l1PressureByOpId,
    ]);

    return { ...availability, annotationsByOpId };
};
