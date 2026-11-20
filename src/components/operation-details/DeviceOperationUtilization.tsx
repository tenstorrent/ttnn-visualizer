// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Fragment, useState } from 'react';
import {
    Button,
    ButtonVariant,
    Collapse,
    Icon,
    Popover,
    PopoverInteractionKind,
    Position,
    Size,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { DrilldownTarget } from '../../definitions/EventLogEvent';
import {
    HARDWARE_COUNTER_ABSENCE_LABELS,
    HARDWARE_COUNTER_FAMILY_LABELS,
    HARDWARE_COUNTER_UNIT_LABELS,
    HardwareCounterAbsence,
    HardwareCounterMeasure,
    getHardwareCounterCaptureAdvice,
} from '../../definitions/HardwareCounters';
import { LoadingSpinnerSizes } from '../../definitions/LoadingSpinner';
import { TEST_IDS } from '../../definitions/TestIds';
import getResponseError from '../../functions/getResponseError';
import { formatHardwareCounterValue } from '../../functions/hardwareCounters';
import { formatPercentage } from '../../functions/math';
import { recordDrilldownOpened } from '../../functions/surfaceEvents';
import { useOperationHardwareCounters } from '../../hooks/useAPI';
import {
    HardwareCounterFamilyReading,
    HardwareCounterReading,
    HardwareCounterUnitReading,
    OperationHardwareCounters,
} from '../../model/HardwareCounters';
import LoadingSpinner from '../LoadingSpinner';
import 'styles/components/DeviceOperationUtilization.scss';

const MAX_PERCENT = 100;
const MODEL_DECIMALS = 1;
const MISSING_VALUE = '—';

const TRIGGER_LABEL = 'Utilization';
const TRIGGER_TITLE = 'How busy each unit was, from hardware counters';
const PANEL_TITLE = 'Hardware counters';
const CAPTION_RANGE = 'with the Min–Max range across those cores, read once over the kernel.';
// tt-perf-report's `merge_device_rows`, which keeps one device's row for each operation.
const MERGED_DEVICES_CAPTION =
    "The report merges an operation's devices into one row: the device with the longest kernel duration, or the " +
    'lowest-numbered device for an all-gather, reduce-scatter or all-reduce.';
const NO_COMPUTE_KERNEL =
    'No counters for this operation: it has no compute kernel, and tt-metal reads counters only while one runs.';
const NOT_RECORDED = 'No counters were recorded for this operation.';
const NO_VALUE_REASON = HARDWARE_COUNTER_ABSENCE_LABELS[HardwareCounterAbsence.NO_VALUE];
const NOT_CAPTURED_LABEL = HARDWARE_COUNTER_ABSENCE_LABELS[HardwareCounterAbsence.NOT_CAPTURED];
const NO_REPORT_COUNTERS = 'This performance report has no hardware counters.';
const FULL_GRID_LABEL = 'Full grid, idle cores counted';
const MODEL_TITLE = 'Performance model';
const MODEL_CAPTION = 'Modelled compute time over the measured kernel time: an estimate, not a hardware counter.';
const NOT_MODELLED = 'not modelled for this operation';
const ALL_COUNTERS_LABEL = 'All counters';
const LOAD_FAILED = 'Hardware counters could not be loaded.';
const STAT_COLUMNS: { heading: string; read: (reading: HardwareCounterReading) => number | null }[] = [
    { heading: 'Min', read: (reading) => reading.min },
    { heading: 'Median', read: (reading) => reading.median },
    { heading: 'Max', read: (reading) => reading.max },
    { heading: 'Avg', read: (reading) => reading.avg },
];

const clampPercent = (value: number): number => Math.min(Math.max(value, 0), MAX_PERCENT);

const formatStat = (value: number | null, reading: HardwareCounterReading): string =>
    value === null ? '' : formatHardwareCounterValue(value, reading.measure);

const getAbsenceLabel = (reading: HardwareCounterReading): string =>
    HARDWARE_COUNTER_ABSENCE_LABELS[reading.absence ?? HardwareCounterAbsence.NO_VALUE];

const getMissingReason = (label: string, fillHint: string | null): string =>
    fillHint ? `${label}: ${fillHint}` : label;

const getAbsenceReason = (reading: HardwareCounterReading): string =>
    getMissingReason(getAbsenceLabel(reading), reading.fill_hint);

const getPanelCaption = (deviceId: number | null): string => {
    const cores = deviceId === null ? 'the cores' : `the cores of device ${deviceId}`;
    const caption = `Each bar is the unit's average utilization across ${cores} that ran the operation's compute kernel, ${CAPTION_RANGE}`;

    return deviceId === null ? caption : `${caption} ${MERGED_DEVICES_CAPTION}`;
};

interface MissingValueProps {
    reason: string;
}

// The role lets the dash carry the reason as its name: ARIA ignores `aria-label` on a bare span.
const MissingValue = ({ reason }: MissingValueProps) => (
    <span
        className='hardware-counter-missing'
        title={reason}
        role='img'
        aria-label={reason}
    >
        {MISSING_VALUE}
    </span>
);

interface AbsenceProps {
    reading: HardwareCounterReading;
    className: string;
}

// Takes a unit's bar's place, so it is an image named like the bar, with what fills the unit.
const Absence = ({ reading, className }: AbsenceProps) => (
    <span
        className={className}
        title={reading.fill_hint ?? undefined}
        role='img'
        aria-label={getAbsenceReason(reading)}
    >
        {getAbsenceLabel(reading)}
    </span>
);

interface UnitRowProps {
    reading: HardwareCounterUnitReading;
}

const UnitRow = ({ reading }: UnitRowProps) => {
    const name = HARDWARE_COUNTER_UNIT_LABELS[reading.unit] ?? reading.label;
    const { avg, min, max } = reading;

    if (reading.absence !== null || avg === null) {
        return (
            <>
                <span className='hardware-counter-unit-name'>{name}</span>
                <Absence
                    reading={reading}
                    className='hardware-counter-absent'
                />
            </>
        );
    }

    const average = formatStat(avg, reading);
    const hasRange = min !== null && max !== null;
    const range = hasRange ? `${formatStat(min, reading)}–${formatStat(max, reading)}` : '';

    return (
        <>
            <span className='hardware-counter-unit-name'>{name}</span>
            <div
                className='hardware-counter-bar'
                role='img'
                aria-label={hasRange ? `${name}: ${average} average, ${range} across cores` : `${name}: ${average}`}
                data-testid={`${TEST_IDS.HARDWARE_COUNTER_UNIT}-${reading.unit}`}
            >
                <div
                    className='hardware-counter-bar-fill'
                    style={{ width: `${clampPercent(avg)}%` }}
                />
                {hasRange && (
                    <div
                        className='hardware-counter-bar-range'
                        style={{ left: `${clampPercent(min)}%`, width: `${clampPercent(max) - clampPercent(min)}%` }}
                    />
                )}
            </div>
            <span className='hardware-counter-value'>
                {average}
                {hasRange && <span className='hardware-counter-range'> {range}</span>}
            </span>
        </>
    );
};

interface FamilyRowsProps {
    family: HardwareCounterFamilyReading;
}

const FamilyRows = ({ family }: FamilyRowsProps) => (
    <tbody>
        <tr className='hardware-counter-family-heading'>
            <th colSpan={STAT_COLUMNS.length + 1}>{HARDWARE_COUNTER_FAMILY_LABELS[family.family]}</th>
        </tr>
        {family.captured ? (
            family.metrics.map((metric) => (
                <tr key={metric.label}>
                    <td>{metric.label}</td>
                    {metric.absence !== null ? (
                        <td colSpan={STAT_COLUMNS.length}>
                            <MissingValue reason={getAbsenceReason(metric)} />
                        </td>
                    ) : (
                        STAT_COLUMNS.map(({ heading, read }) => (
                            <td key={heading}>{formatStat(read(metric), metric)}</td>
                        ))
                    )}
                </tr>
            ))
        ) : (
            <tr>
                <td
                    colSpan={STAT_COLUMNS.length + 1}
                    className='hardware-counter-absent'
                    title={family.fill_hint}
                    aria-label={getMissingReason(NOT_CAPTURED_LABEL, family.fill_hint)}
                >
                    {NOT_CAPTURED_LABEL}
                </td>
            </tr>
        )}
    </tbody>
);

interface PerformanceModelProps {
    fpuUtil: number | null;
}

const PerformanceModel = ({ fpuUtil }: PerformanceModelProps) => (
    <div
        className='hardware-counter-model'
        data-testid={TEST_IDS.HARDWARE_COUNTER_MODEL}
    >
        <div className='hardware-counter-heading'>{MODEL_TITLE}</div>
        <div>
            FPU{' '}
            {fpuUtil !== null ? (
                <strong>{formatPercentage(fpuUtil, MODEL_DECIMALS)}</strong>
            ) : (
                <span className='hardware-counter-absent'>{NOT_MODELLED}</span>
            )}
        </div>
        <p className='hardware-counter-caption'>{MODEL_CAPTION}</p>
    </div>
);

interface OperationCountersProps {
    counters: OperationHardwareCounters;
    deviceId: number | null;
}

const OperationCounters = ({ counters, deviceId }: OperationCountersProps) => {
    if (!counters.op_has_counters) {
        return (
            <p
                className='hardware-counter-note'
                data-testid={TEST_IDS.HARDWARE_COUNTER_NOTE}
            >
                {counters.has_compute_kernel === false ? NO_COMPUTE_KERNEL : NOT_RECORDED}
            </p>
        );
    }

    return (
        <>
            <p className='hardware-counter-caption'>{getPanelCaption(deviceId)}</p>
            <div className='hardware-counter-units'>
                {counters.units.map((reading) => (
                    <UnitRow
                        key={reading.unit}
                        reading={reading}
                    />
                ))}
            </div>
            {counters.full_grid.length > 0 && (
                <p className='hardware-counter-grid'>
                    {FULL_GRID_LABEL}:{' '}
                    {counters.full_grid.map((grid, index) => (
                        <Fragment key={grid.unit}>
                            {index > 0 && ' · '}
                            {HARDWARE_COUNTER_UNIT_LABELS[grid.unit]}{' '}
                            {grid.value !== null ? (
                                formatHardwareCounterValue(grid.value, HardwareCounterMeasure.PERCENT)
                            ) : (
                                <MissingValue reason={NO_VALUE_REASON} />
                            )}
                        </Fragment>
                    ))}
                </p>
            )}
        </>
    );
};

interface HardwareCounterPanelProps {
    counters: OperationHardwareCounters;
    // On a report of several devices the merged row is one device's, which the panel names.
    isMultiDevice?: boolean;
}

export const HardwareCounterPanel = ({ counters, isMultiDevice = false }: HardwareCounterPanelProps) => {
    const [isShowingAll, setIsShowingAll] = useState(false);
    const deviceId = isMultiDevice ? counters.device_id : null;

    return (
        <div
            className='hardware-counter-panel'
            data-testid={TEST_IDS.HARDWARE_COUNTER_PANEL}
        >
            <div className='hardware-counter-heading'>
                {PANEL_TITLE}
                {deviceId !== null && (
                    <span
                        className='hardware-counter-device'
                        data-testid={TEST_IDS.HARDWARE_COUNTER_DEVICE}
                    >
                        {' '}
                        · Device {deviceId}
                    </span>
                )}
            </div>
            {counters.has_counters ? (
                <OperationCounters
                    counters={counters}
                    deviceId={deviceId}
                />
            ) : (
                <div
                    className='hardware-counter-empty'
                    data-testid={TEST_IDS.HARDWARE_COUNTER_EMPTY}
                >
                    <p>{NO_REPORT_COUNTERS}</p>
                    <p>
                        {getHardwareCounterCaptureAdvice((fragment) => (
                            <code key={fragment}>{fragment}</code>
                        ))}
                    </p>
                </div>
            )}

            <PerformanceModel fpuUtil={counters.performance_model.fpu_util} />

            {counters.families.length > 0 && (
                <>
                    <Button
                        className='hardware-counter-all-toggle'
                        variant={ButtonVariant.MINIMAL}
                        size={Size.SMALL}
                        endIcon={isShowingAll ? IconNames.CARET_UP : IconNames.CARET_DOWN}
                        aria-expanded={isShowingAll}
                        onClick={() => setIsShowingAll((isOpen) => !isOpen)}
                    >
                        {ALL_COUNTERS_LABEL}
                    </Button>
                    <Collapse isOpen={isShowingAll}>
                        <table className='hardware-counter-family-table'>
                            <thead>
                                <tr>
                                    <th>Counter</th>
                                    {STAT_COLUMNS.map(({ heading }) => (
                                        <th key={heading}>{heading}</th>
                                    ))}
                                </tr>
                            </thead>
                            {counters.families.map((family) => (
                                <FamilyRows
                                    key={family.family}
                                    family={family}
                                />
                            ))}
                        </table>
                    </Collapse>
                </>
            )}
        </div>
    );
};

interface HardwareCounterPanelLoaderProps {
    perfId: number;
    isMultiDevice: boolean;
}

const HardwareCounterPanelLoader = ({ perfId, isMultiDevice }: HardwareCounterPanelLoaderProps) => {
    const { data, error, isLoading } = useOperationHardwareCounters(perfId);

    if (isLoading) {
        return (
            <div className='hardware-counter-panel'>
                <LoadingSpinner size={LoadingSpinnerSizes.SMALL} />
            </div>
        );
    }

    if (error || !data) {
        return <div className='hardware-counter-panel'>{getResponseError(error, LOAD_FAILED)}</div>;
    }

    return (
        <HardwareCounterPanel
            counters={data}
            isMultiDevice={isMultiDevice}
        />
    );
};

interface DeviceOperationUtilizationProps {
    perfId: number | null;
    isMultiDevice?: boolean;
}

/** Opens the operation's hardware counter panel, fetched on first open. */
const DeviceOperationUtilization = ({ perfId, isMultiDevice = false }: DeviceOperationUtilizationProps) => {
    const [isOpen, setIsOpen] = useState(false);

    if (perfId === null) {
        return null;
    }

    const handleInteraction = (nextIsOpen: boolean) => {
        if (nextIsOpen && !isOpen) {
            recordDrilldownOpened(DrilldownTarget.HARDWARE_COUNTERS);
        }

        setIsOpen(nextIsOpen);
    };

    return (
        <Popover
            content={
                <HardwareCounterPanelLoader
                    perfId={perfId}
                    isMultiDevice={isMultiDevice}
                />
            }
            interactionKind={PopoverInteractionKind.CLICK}
            isOpen={isOpen}
            onInteraction={handleInteraction}
            position={Position.BOTTOM_LEFT}
            popoverClassName='hardware-counter-popover'
        >
            <Button
                icon={
                    <Icon
                        icon={IconNames.DASHBOARD}
                        size={12}
                    />
                }
                size={Size.SMALL}
                variant={ButtonVariant.OUTLINED}
                title={TRIGGER_TITLE}
                data-testid={TEST_IDS.HARDWARE_COUNTER_TRIGGER}
            >
                {TRIGGER_LABEL}
            </Button>
        </Popover>
    );
};

export default DeviceOperationUtilization;
