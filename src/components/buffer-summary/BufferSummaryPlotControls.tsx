// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { HTMLSelect, NumericInput, PopoverPosition, Switch, Tooltip } from '@blueprintjs/core';
import { useAtom, useAtomValue } from 'jotai';
import GlobalSwitch from '../GlobalSwitch';
import {
    renderMemoryLayoutAtom,
    selectedBufferSummaryTabAtom,
    showBufferSummaryZoomedAtom,
    showDeallocationReportAtom,
    showHexAtom,
    showMemoryRegionsAtom,
    topNAnnotationCountAtom,
    topNAnnotationEnabledAtom,
    topNAnnotationModeAtom,
} from '../../store/app';
import { TAB_IDS } from '../../definitions/BufferSummary';
import {
    TOP_N_COUNT_MAX,
    TOP_N_COUNT_MIN,
    TOP_N_MODE_LABEL,
    TopNAnnotationMode,
    TopNAnnotationStatus,
} from '../../functions/topNAnnotations';
import { useTopNAnnotationAvailability } from '../../hooks/useTopNAnnotations';
import 'styles/components/BufferSummaryControls.scss';

// Static copy for the disabled-toggle tooltip, keyed by (mode, availability
// state). Mirrors the PERF_OVERLAY_TOOLTIP map in OperationGraphComponent so
// the two surfaces use the same vocabulary for the same problem.
//
// All perf-derived modes share the same source (the perf report), so they
// share UNLINKED copy and differ only on the per-metric READY / UNAVAILABLE
// strings.
const TOP_N_STATUS_TOOLTIP: Record<TopNAnnotationMode, Record<TopNAnnotationStatus, string>> = {
    [TopNAnnotationMode.PERF_TIME]: {
        [TopNAnnotationStatus.UNAVAILABLE]: 'Load a performance report to enable kernel-duration highlights.',
        [TopNAnnotationStatus.UNLINKED]:
            "Loaded performance report doesn't match this profiler report (no operations in common).",
        [TopNAnnotationStatus.NO_DATA]: "Loaded performance report doesn't include kernel-duration data.",
        [TopNAnnotationStatus.READY]: 'Highlight the top-N ops on the timeline by kernel duration.',
    },
    [TopNAnnotationMode.PERF_OP_TO_OP_GAP]: {
        [TopNAnnotationStatus.UNAVAILABLE]: 'Load a performance report to enable op-to-op gap highlights.',
        [TopNAnnotationStatus.UNLINKED]:
            "Loaded performance report doesn't match this profiler report (no operations in common).",
        [TopNAnnotationStatus.NO_DATA]: "Loaded performance report doesn't include op-to-op gap data.",
        [TopNAnnotationStatus.READY]: 'Highlight the top-N ops by dispatch / host-side stall (op-to-op gap).',
    },
    [TopNAnnotationMode.PERF_DRAM_PERCENT]: {
        [TopNAnnotationStatus.UNAVAILABLE]: 'Load a performance report to enable DRAM-utilization highlights.',
        [TopNAnnotationStatus.UNLINKED]:
            "Loaded performance report doesn't match this profiler report (no operations in common).",
        [TopNAnnotationStatus.NO_DATA]: "Loaded performance report doesn't include DRAM-utilization data.",
        [TopNAnnotationStatus.READY]: 'Highlight the top-N ops by DRAM bandwidth utilization.',
    },
    [TopNAnnotationMode.PERF_FLOPS_PERCENT]: {
        [TopNAnnotationStatus.UNAVAILABLE]: 'Load a performance report to enable FLOPS-utilization highlights.',
        [TopNAnnotationStatus.UNLINKED]:
            "Loaded performance report doesn't match this profiler report (no operations in common).",
        [TopNAnnotationStatus.NO_DATA]: "Loaded performance report doesn't include FLOPS-utilization data.",
        [TopNAnnotationStatus.READY]: 'Highlight the top-N ops by FLOPS utilization.',
    },
    [TopNAnnotationMode.L1_FULLNESS]: {
        [TopNAnnotationStatus.UNAVAILABLE]: 'L1 fullness highlights are only available on the L1 tab.',
        [TopNAnnotationStatus.UNLINKED]: "L1 pressure data isn't available for this profiler report.",
        [TopNAnnotationStatus.NO_DATA]: "L1 pressure data isn't available for this profiler report.",
        [TopNAnnotationStatus.READY]: 'Highlight the top-N ops on the timeline by L1 fullness.',
    },
};

// Dropdown render order (top → bottom). Perf modes first because perf data is
// the more common entry point; L1 fullness anchors the bottom of the list.
const TOP_N_MODE_ORDER: TopNAnnotationMode[] = [
    TopNAnnotationMode.PERF_TIME,
    TopNAnnotationMode.PERF_OP_TO_OP_GAP,
    TopNAnnotationMode.PERF_DRAM_PERCENT,
    TopNAnnotationMode.PERF_FLOPS_PERCENT,
    TopNAnnotationMode.L1_FULLNESS,
];

const BufferSummaryPlotControls = () => {
    const [showDeallocationReport, setShowDeallocationReport] = useAtom(showDeallocationReportAtom);
    const [renderMemoryLayout, setRenderMemoryLayout] = useAtom(renderMemoryLayoutAtom);
    const [showHex, setShowHex] = useAtom(showHexAtom);
    const [isZoomedIn, setIsZoomedIn] = useAtom(showBufferSummaryZoomedAtom);
    const [showMemoryRegions, setShowMemoryRegions] = useAtom(showMemoryRegionsAtom);
    const selectedTabId = useAtomValue(selectedBufferSummaryTabAtom);

    const [topNEnabled, setTopNEnabled] = useAtom(topNAnnotationEnabledAtom);
    const [topNMode, setTopNMode] = useAtom(topNAnnotationModeAtom);
    const [topNCount, setTopNCount] = useAtom(topNAnnotationCountAtom);

    // DRAM tab forces L1_FULLNESS to UNAVAILABLE — fullness is computed
    // against the L1 budget and has no meaning in DRAM space.
    const { statusByMode } = useTopNAnnotationAvailability({
        forceL1Unavailable: selectedTabId === TAB_IDS.DRAM,
    });

    const activeStatus = statusByMode[topNMode];
    const isTopNDisabled = activeStatus !== TopNAnnotationStatus.READY;
    const topNTooltip = TOP_N_STATUS_TOOLTIP[topNMode][activeStatus];

    // Disabled iff *every* mode is unselectable — otherwise the user can
    // still pick a different metric, so leave the select interactive.
    const isModeSelectDisabled = TOP_N_MODE_ORDER.every((mode) => statusByMode[mode] !== TopNAnnotationStatus.READY);

    return (
        <div className='buffer-summary-controls'>
            <Switch
                label='Buffer zoom'
                checked={isZoomedIn}
                onChange={() => setIsZoomedIn(!isZoomedIn)}
            />

            {selectedTabId === TAB_IDS.L1 ? (
                <GlobalSwitch
                    label='Mark late tensor deallocations'
                    checked={showDeallocationReport}
                    onChange={() => {
                        setShowDeallocationReport(!showDeallocationReport);
                    }}
                />
            ) : null}

            <GlobalSwitch
                label='Use Hex'
                checked={showHex}
                onChange={() => {
                    setShowHex(!showHex);
                }}
            />

            <GlobalSwitch
                label='Tensor memory layout overlay'
                checked={renderMemoryLayout}
                onChange={() => {
                    setRenderMemoryLayout(!renderMemoryLayout);
                }}
            />

            {selectedTabId === TAB_IDS.L1 ? (
                <GlobalSwitch
                    label='Memory regions'
                    checked={showMemoryRegions}
                    onChange={() => {
                        setShowMemoryRegions(!showMemoryRegions);
                    }}
                />
            ) : null}

            <div
                className='top-n-controls'
                data-testid='top-n-controls'
            >
                <Tooltip
                    content={topNTooltip}
                    placement={PopoverPosition.BOTTOM}
                >
                    <Switch
                        label='Highlight top'
                        checked={topNEnabled && !isTopNDisabled}
                        onChange={() => setTopNEnabled(!topNEnabled)}
                        disabled={isTopNDisabled}
                    />
                </Tooltip>
                <NumericInput
                    aria-label='Top-N count'
                    value={topNCount}
                    min={TOP_N_COUNT_MIN}
                    max={TOP_N_COUNT_MAX}
                    minorStepSize={null}
                    stepSize={1}
                    majorStepSize={5}
                    clampValueOnBlur
                    disabled={isTopNDisabled}
                    onValueChange={(value) => {
                        if (Number.isFinite(value)) {
                            const clamped = Math.min(TOP_N_COUNT_MAX, Math.max(TOP_N_COUNT_MIN, Math.round(value)));
                            setTopNCount(clamped);
                        }
                    }}
                />
                <span className='top-n-by'>ops by</span>
                <HTMLSelect
                    aria-label='Top-N annotation mode'
                    value={topNMode}
                    disabled={isModeSelectDisabled}
                    onChange={(event) => setTopNMode(event.currentTarget.value as TopNAnnotationMode)}
                    options={TOP_N_MODE_ORDER.map((mode) => ({
                        value: mode,
                        label: TOP_N_MODE_LABEL[mode],
                        disabled: statusByMode[mode] !== TopNAnnotationStatus.READY,
                    }))}
                />
            </div>
        </div>
    );
};

export default BufferSummaryPlotControls;
