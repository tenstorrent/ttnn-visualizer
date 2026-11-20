// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeviceOperationUtilization, {
    HardwareCounterPanel,
} from '../src/components/operation-details/DeviceOperationUtilization';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';
import { DrilldownTarget, EventLogEvent } from '../src/definitions/EventLogEvent';
import {
    HARDWARE_COUNTER_CAPTURE_FLAG,
    HARDWARE_COUNTER_UNIT_LABELS,
    HardwareCounterAbsence,
    HardwareCounterFamily,
    HardwareCounterMeasure,
    HardwareCounterUnit,
    NO_HARDWARE_COUNTERS_HINT,
    getHardwareCounterCaptureAdvice,
} from '../src/definitions/HardwareCounters';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useOperationHardwareCounters } from '../src/hooks/useAPI';
import {
    HardwareCounterFamilyReading,
    HardwareCounterGridReading,
    HardwareCounterReading,
    HardwareCounterUnitReading,
    OperationHardwareCounters,
} from '../src/model/HardwareCounters';
import { openPopover } from './helpers/testForPortal';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useOperationHardwareCounters: vi.fn(),
}));

const hint = (groups: string) => `filled when the capture ran with ${HARDWARE_COUNTER_CAPTURE_FLAG}=${groups}`;
const PACK_HINT = hint('pack');
const L1_1_HINT = hint('l1_1');
const NOC_RING1_HINT = hint('l1_1 or =l1_3');
const NO_VALUE = 'no value for this operation';
const NOT_CAPTURED = 'not captured';

const reading = (label: string, overrides: Partial<HardwareCounterReading> = {}): HardwareCounterReading => ({
    label,
    measure: HardwareCounterMeasure.PERCENT,
    min: null,
    median: null,
    max: null,
    avg: null,
    absence: null,
    fill_hint: null,
    ...overrides,
});

const measured = (min: number, avg: number, max: number) => ({ min, median: avg, max, avg });

const unit = (
    unitKey: HardwareCounterUnit,
    family: HardwareCounterFamily,
    label: string,
    overrides: Partial<HardwareCounterReading> = {},
): HardwareCounterUnitReading => ({
    ...reading(label, overrides),
    unit: unitKey,
    family,
});

const family = (
    familyKey: HardwareCounterFamily,
    metrics: HardwareCounterReading[],
    fillHint: string,
): HardwareCounterFamilyReading => ({ family: familyKey, captured: true, fill_hint: fillHint, metrics });

const grid = (unitKey: HardwareCounterUnit, value: number | null): HardwareCounterGridReading => ({
    unit: unitKey,
    column: `Avg ${unitKey === HardwareCounterUnit.MATH ? 'Math' : unitKey.toUpperCase()} util on full grid (%)`,
    value,
});

// Shaped as the route answers a Blackhole capture of fpu, pack, unpack, instrn and l1_0: all nine units, NoC ring 1
// not captured, the three full-grid figures, and every family captured with its per-label absences.
const MATMUL: OperationHardwareCounters = {
    perf_id: 2,
    has_counters: true,
    op_has_counters: true,
    architecture: DeviceArchitecture.BLACKHOLE,
    device_id: 0,
    has_compute_kernel: true,
    units: [
        unit(HardwareCounterUnit.FPU, HardwareCounterFamily.COMPUTE, 'FPU Util', {
            min: 8.879,
            median: 9.4,
            max: 9.887,
            avg: 9.396,
        }),
        unit(HardwareCounterUnit.SFPU, HardwareCounterFamily.COMPUTE, 'SFPU Util', measured(0, 0, 0)),
        unit(HardwareCounterUnit.MATH, HardwareCounterFamily.COMPUTE, 'MATH Util', {
            min: 8.879,
            median: 9.4,
            max: 9.887,
            avg: 9.396,
        }),
        unit(HardwareCounterUnit.PACKER, HardwareCounterFamily.PACK, 'Packer Utilization', measured(7.5, 8, 8.5)),
        unit(
            HardwareCounterUnit.UNPACKER0,
            HardwareCounterFamily.UNPACK,
            'Unpacker0 Busy T0 Util',
            measured(7.5, 8, 9),
        ),
        unit(
            HardwareCounterUnit.UNPACKER1,
            HardwareCounterFamily.UNPACK,
            'Unpacker1 Busy T0 Util',
            measured(3, 3, 3.5),
        ),
        unit(
            HardwareCounterUnit.L1_BANDWIDTH,
            HardwareCounterFamily.L1_PORTS,
            'L1 Total Bandwidth Util',
            measured(4.5, 5.5, 7),
        ),
        unit(HardwareCounterUnit.NOC_RING0, HardwareCounterFamily.NOC_RING, 'NOC Ring 0 Util', measured(4.5, 5.5, 9.5)),
        unit(HardwareCounterUnit.NOC_RING1, HardwareCounterFamily.NOC_RING, 'NOC Ring 1 Util', {
            absence: HardwareCounterAbsence.NOT_CAPTURED,
            fill_hint: NOC_RING1_HINT,
        }),
    ],
    full_grid: [
        grid(HardwareCounterUnit.FPU, 5.994),
        grid(HardwareCounterUnit.SFPU, 0),
        grid(HardwareCounterUnit.MATH, 5.994),
    ],
    families: [
        family(
            HardwareCounterFamily.COMPUTE,
            [
                reading('FPU Util', { min: 8.879, median: 9.4, max: 9.887, avg: 9.396 }),
                reading('FPU Execution Efficiency', {
                    measure: HardwareCounterMeasure.RATIO,
                    min: 0.5,
                    median: 0.6,
                    max: 0.7,
                    avg: 0.61234,
                }),
            ],
            hint('fpu'),
        ),
        family(
            HardwareCounterFamily.UNPACK,
            [
                reading('Unpacker0 Busy T0 Util', measured(7.5, 8, 9)),
                reading('SrcB Write Actual Efficiency', measured(40, 50, 60)),
            ],
            hint('unpack'),
        ),
        family(
            HardwareCounterFamily.PACK,
            [
                reading('Packer Utilization', measured(7.5, 8, 8.5)),
                reading('Packer Engine 0 Util', { absence: HardwareCounterAbsence.NOT_ON_ARCHITECTURE }),
            ],
            PACK_HINT,
        ),
        family(
            HardwareCounterFamily.L1_PORTS,
            [
                reading('L1 Total Bandwidth Util', measured(4.5, 5.5, 7)),
                reading('L1 Packer Port 8 Util', {
                    absence: HardwareCounterAbsence.NOT_CAPTURED,
                    fill_hint: L1_1_HINT,
                }),
            ],
            hint('l1_0,l1_1'),
        ),
        family(
            HardwareCounterFamily.NOC_RING,
            [
                reading('NOC Ring 0 Util', measured(4.5, 5.5, 9.5)),
                reading('NOC Ring 1 Util', { absence: HardwareCounterAbsence.NOT_CAPTURED, fill_hint: NOC_RING1_HINT }),
            ],
            hint('l1_0,l1_1'),
        ),
        family(
            HardwareCounterFamily.INSTRUCTION_ISSUE,
            [reading('T0 Instrn Issue Rate', measured(1, 2, 3))],
            hint('instrn'),
        ),
        family(HardwareCounterFamily.STALLS, [reading('Thread 0 Stall Rate', measured(10, 20, 30))], hint('instrn')),
    ],
    performance_model: { fpu_util: 6.251 },
};

const noValue = (label: string): HardwareCounterReading => ({
    ...reading(label),
    absence: HardwareCounterAbsence.NO_VALUE,
});

const withNoValues = (readings: HardwareCounterReading[]) =>
    readings.map((metric) => (metric.absence === null ? noValue(metric.label) : metric));

// A concat: no compute kernel, so every label of the capture reads no value, and so does each full-grid figure.
const CONCAT: OperationHardwareCounters = {
    ...MATMUL,
    perf_id: 10,
    op_has_counters: false,
    has_compute_kernel: false,
    units: MATMUL.units.map((metric) => (metric.absence === null ? { ...metric, ...noValue(metric.label) } : metric)),
    full_grid: MATMUL.full_grid.map((figure) => ({ ...figure, value: null })),
    families: MATMUL.families.map((familyReading) => ({
        ...familyReading,
        metrics: withNoValues(familyReading.metrics),
    })),
    performance_model: { fpu_util: null },
};

// A compute op whose counters were never recorded, as when the profiler's buffer filled.
const UNRECORDED: OperationHardwareCounters = { ...CONCAT, has_compute_kernel: true };

// What fills each unit on Blackhole, as the route names it for a capture without the unit's group.
const UNIT_FILL_HINTS: Record<HardwareCounterUnit, string> = {
    [HardwareCounterUnit.FPU]: hint('fpu'),
    [HardwareCounterUnit.SFPU]: hint('fpu'),
    [HardwareCounterUnit.MATH]: hint('fpu'),
    [HardwareCounterUnit.PACKER]: PACK_HINT,
    [HardwareCounterUnit.UNPACKER0]: hint('unpack'),
    [HardwareCounterUnit.UNPACKER1]: hint('unpack'),
    [HardwareCounterUnit.L1_BANDWIDTH]: hint('l1_0'),
    [HardwareCounterUnit.NOC_RING0]: hint('l1_0 or =l1_2'),
    [HardwareCounterUnit.NOC_RING1]: NOC_RING1_HINT,
};

// A capture of instrn alone: the op has counters, but none of a unit's.
const INSTRN_ONLY: OperationHardwareCounters = {
    ...MATMUL,
    units: MATMUL.units.map((metric) => ({
        ...metric,
        ...reading(metric.label, {
            absence: HardwareCounterAbsence.NOT_CAPTURED,
            fill_hint: UNIT_FILL_HINTS[metric.unit],
        }),
    })),
    full_grid: [],
    families: MATMUL.families.filter(
        (familyReading) =>
            familyReading.family === HardwareCounterFamily.INSTRUCTION_ISSUE ||
            familyReading.family === HardwareCounterFamily.STALLS,
    ),
};

const NO_COUNTERS: OperationHardwareCounters = {
    perf_id: 2,
    has_counters: false,
    op_has_counters: false,
    architecture: null,
    device_id: null,
    has_compute_kernel: null,
    units: [],
    full_grid: [],
    families: [],
    performance_model: { fpu_util: 42.5 },
};

const renderPanel = (counters: OperationHardwareCounters, isMultiDevice = false) =>
    render(
        <HardwareCounterPanel
            counters={counters}
            isMultiDevice={isMultiDevice}
        />,
    ).container;

// The cells a unit row renders after its name: its bar and value, or its absence.
const unitCells = (name: string) => {
    const label = screen.getByText(name, { selector: '.hardware-counter-unit-name' });
    const cells: (string | null)[] = [];

    for (let sibling = label.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        if (sibling.classList.contains('hardware-counter-unit-name')) {
            break;
        }

        cells.push(sibling.textContent);
    }

    return cells.join(' ');
};

const familyRow = (label: string) => screen.getByText(label, { selector: 'td' }).closest('tr')!;

const allCountersToggle = () => screen.getByRole('button', { name: 'All counters' });

const showAllCounters = () => fireEvent.click(allCountersToggle());

const utilizationTrigger = () => screen.getByRole('button', { name: 'Utilization' });

afterEach(cleanup);

describe('HardwareCounterPanel', () => {
    it("draws a unit's average across cores with its Min–Max range", () => {
        renderPanel(MATMUL);

        const bar = screen.getByTestId(`${TEST_IDS.HARDWARE_COUNTER_UNIT}-${HardwareCounterUnit.FPU}`);

        expect(bar).toHaveAttribute('aria-label', 'FPU: 9.4% average, 8.9%–9.9% across cores');
        expect(unitCells('FPU')).toContain('9.4%');
        expect(unitCells('FPU')).toContain('8.9%–9.9%');
    });

    it('labels the bars as hardware counters', () => {
        renderPanel(MATMUL);

        expect(screen.getByText('Hardware counters')).toBeInTheDocument();
    });

    it('reads a measured 0 as 0%, which is a value', () => {
        renderPanel(MATMUL);

        expect(unitCells('SFPU')).toContain('0%');
    });

    it('draws every unit the route answers, one row each', () => {
        renderPanel(MATMUL);

        expect([...document.querySelectorAll('.hardware-counter-unit-name')].map((name) => name.textContent)).toEqual([
            'FPU',
            'SFPU',
            'MATH',
            'Packer',
            'Unpacker 0',
            'Unpacker 1',
            'L1 bandwidth',
            'NoC ring 0',
            'NoC ring 1',
        ]);
    });

    it('says a group the capture lacks was not captured, naming what fills it, never 0', () => {
        renderPanel(MATMUL);

        expect(unitCells('NoC ring 1')).toBe(NOT_CAPTURED);
        expect(screen.getByLabelText(`${NOT_CAPTURED}: ${NOC_RING1_HINT}`)).toHaveTextContent(NOT_CAPTURED);
    });

    it('reads every unit as not captured, naming its group, for a capture of other groups only', () => {
        renderPanel(INSTRN_ONLY);

        INSTRN_ONLY.units.forEach((metric) =>
            expect(unitCells(HARDWARE_COUNTER_UNIT_LABELS[metric.unit])).toBe(NOT_CAPTURED),
        );
        expect(screen.getAllByRole('img').map((element) => element.getAttribute('aria-label'))).toEqual(
            INSTRN_ONLY.units.map((metric) => `${NOT_CAPTURED}: ${UNIT_FILL_HINTS[metric.unit]}`),
        );
        expect(document.querySelector('.hardware-counter-bar')).toBeNull();
    });

    it('keeps a range past 100% inside its bar, and still reads the value', () => {
        renderPanel({
            ...MATMUL,
            units: MATMUL.units.map((metric) =>
                metric.unit === HardwareCounterUnit.PACKER
                    ? { ...metric, min: 90, median: 98, avg: 98, max: 104 }
                    : metric,
            ),
        });

        const bar = screen.getByTestId(`${TEST_IDS.HARDWARE_COUNTER_UNIT}-${HardwareCounterUnit.PACKER}`);
        const range = bar.querySelector<HTMLElement>('.hardware-counter-bar-range')!;

        expect(parseFloat(range.style.left) + parseFloat(range.style.width)).toBeLessThanOrEqual(100);
        expect(bar.querySelector<HTMLElement>('.hardware-counter-bar-fill')!.style.width).toBe('98%');
        expect(unitCells('Packer')).toContain('90%–104%');
    });

    it('keeps the text for one unit with no value on an operation that has counters', () => {
        renderPanel({
            ...MATMUL,
            units: MATMUL.units.map((metric) =>
                metric.unit === HardwareCounterUnit.UNPACKER1 ? { ...metric, ...noValue(metric.label) } : metric,
            ),
        });

        expect(unitCells('Unpacker 1')).toBe(NO_VALUE);
        expect(unitCells('Unpacker 0')).toContain('8%');
    });

    it('says an operation without a compute kernel has no counters, once, rather than a row of absences', () => {
        const container = renderPanel(CONCAT);

        expect(screen.getByTestId(TEST_IDS.HARDWARE_COUNTER_NOTE)).toHaveTextContent('it has no compute kernel');
        expect(container.querySelector('.hardware-counter-units')).toBeNull();
        expect(screen.queryByText(/Full grid/)).toBeNull();
        expect(screen.queryByText(/Each bar/)).toBeNull();
        expect(container).not.toHaveTextContent(NO_VALUE);
    });

    it('says counters were not recorded, without naming a cause, for an operation with a compute kernel', () => {
        renderPanel(UNRECORDED);

        const note = screen.getByTestId(TEST_IDS.HARDWARE_COUNTER_NOTE);

        expect(note).toHaveTextContent('No counters were recorded for this operation.');
        expect(note).not.toHaveTextContent('compute kernel');
    });

    it('shows the full-grid figures apart, saying they count idle cores', () => {
        renderPanel(MATMUL);

        expect(screen.getByText(/Full grid, idle cores counted/)).toHaveTextContent('FPU 6% · SFPU 0% · MATH 6%');
    });

    it('marks a full-grid figure with no value with a dash named for the reason', () => {
        renderPanel({
            ...MATMUL,
            full_grid: MATMUL.full_grid.map((figure) =>
                figure.unit === HardwareCounterUnit.SFPU ? { ...figure, value: null } : figure,
            ),
        });

        const line = screen.getByText(/Full grid, idle cores counted/);

        expect(line).toHaveTextContent('FPU 6% · SFPU — · MATH 6%');
        expect(within(line).getByLabelText(NO_VALUE)).toHaveTextContent('—');
    });

    it("keeps the performance model's figure beside the counters, labelled as the model", () => {
        renderPanel(MATMUL);

        const model = screen.getByTestId(TEST_IDS.HARDWARE_COUNTER_MODEL);

        expect(within(model).getByText('Performance model')).toBeInTheDocument();
        expect(model).toHaveTextContent('FPU 6.3%');
        expect(model).toHaveTextContent('not a hardware counter');
    });

    it('says when the model has no figure for the operation', () => {
        renderPanel(CONCAT);

        expect(screen.getByTestId(TEST_IDS.HARDWARE_COUNTER_MODEL)).toHaveTextContent('not modelled');
    });

    it('names the capture flag when the report has no counters, and still shows the model', () => {
        renderPanel(NO_COUNTERS);

        const empty = screen.getByTestId(TEST_IDS.HARDWARE_COUNTER_EMPTY);

        expect(empty).toHaveTextContent(`${HARDWARE_COUNTER_CAPTURE_FLAG}=<groups>`);
        // The same sentence the table's switch gives as its reason.
        const advice = getHardwareCounterCaptureAdvice((fragment) => fragment).join('');
        expect(empty).toHaveTextContent(advice);
        expect(NO_HARDWARE_COUNTERS_HINT).toContain(advice);
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.getByTestId(TEST_IDS.HARDWARE_COUNTER_MODEL)).toHaveTextContent('FPU 42.5%');
        expect(screen.queryByRole('button', { name: 'All counters' })).toBeNull();
    });

    it('lists every label by family on request, ratios as ratios', () => {
        renderPanel(MATMUL);

        showAllCounters();

        const efficiency = familyRow('FPU Execution Efficiency');
        expect(efficiency).toHaveTextContent('0.612');
        expect(efficiency).not.toHaveTextContent('%');
    });

    it('marks each label the capture or architecture lacks with a dash named for the reason', () => {
        renderPanel(MATMUL);

        showAllCounters();

        expect(within(familyRow('Packer Engine 0 Util')).getByLabelText('N/A on this architecture')).toHaveTextContent(
            '—',
        );
        expect(
            within(familyRow('L1 Packer Port 8 Util')).getByLabelText(`${NOT_CAPTURED}: ${L1_1_HINT}`),
        ).toHaveTextContent('—');
        expect(familyRow('Packer Engine 0 Util')).not.toHaveTextContent('N/A');
    });

    it('marks a label with no value on a compute operation with a dash rather than the sentence', () => {
        renderPanel({
            ...MATMUL,
            families: MATMUL.families.map((familyReading) =>
                familyReading.family === HardwareCounterFamily.UNPACK
                    ? {
                          ...familyReading,
                          metrics: familyReading.metrics.map((metric) =>
                              metric.label === 'SrcB Write Actual Efficiency' ? noValue(metric.label) : metric,
                          ),
                      }
                    : familyReading,
            ),
        });

        showAllCounters();

        const row = familyRow('SrcB Write Actual Efficiency');
        expect(row).toHaveTextContent(/^SrcB Write Actual Efficiency—$/);
        expect(within(row).getByLabelText(NO_VALUE)).toHaveTextContent('—');
    });

    it('lists an operation without counters with a dash per label, never the sentence', () => {
        renderPanel(CONCAT);

        showAllCounters();

        const table = document.querySelector('.hardware-counter-family-table')!;
        const labels = CONCAT.families.flatMap((familyReading) => familyReading.metrics);

        expect(table).not.toHaveTextContent(NO_VALUE);
        expect(within(table as HTMLElement).getAllByText('—')).toHaveLength(labels.length);
    });

    it('says a family the capture lacks was not captured, naming its group', () => {
        renderPanel({
            ...MATMUL,
            families: MATMUL.families.map((familyReading) =>
                familyReading.family === HardwareCounterFamily.PACK
                    ? { ...familyReading, captured: false, metrics: withNoValues(familyReading.metrics) }
                    : familyReading,
            ),
        });

        showAllCounters();

        const pack = screen.getByText('Pack').closest('tbody')!;
        expect(within(pack).getByLabelText(`${NOT_CAPTURED}: ${PACK_HINT}`)).toHaveTextContent(NOT_CAPTURED);
    });

    it('says whether the list of every counter is open', () => {
        renderPanel(MATMUL);

        expect(allCountersToggle()).toHaveAttribute('aria-expanded', 'false');

        showAllCounters();

        expect(allCountersToggle()).toHaveAttribute('aria-expanded', 'true');
    });

    it('names the device whose row it reads on a report of several, and says how the report picks it', () => {
        renderPanel({ ...MATMUL, device_id: 1 }, true);

        expect(screen.getByTestId(TEST_IDS.HARDWARE_COUNTER_DEVICE)).toHaveTextContent('Device 1');
        expect(screen.getByText(/Each bar/)).toHaveTextContent('across the cores of device 1');
        expect(screen.getByText(/Each bar/)).toHaveTextContent('the device with the longest kernel duration');
        expect(screen.getByText(/Each bar/)).toHaveTextContent('lowest-numbered device for an all-gather');
    });

    it('names no device on a single-device report', () => {
        renderPanel(MATMUL);

        expect(screen.queryByTestId(TEST_IDS.HARDWARE_COUNTER_DEVICE)).toBeNull();
        expect(screen.getByText(/Each bar/)).not.toHaveTextContent('device');
    });
});

describe('DeviceOperationUtilization', () => {
    beforeEach(() => {
        recordEvent.mockClear();
        (useOperationHardwareCounters as Mock).mockReset();
        (useOperationHardwareCounters as Mock).mockReturnValue({ data: MATMUL, error: null, isLoading: false });
    });

    it('renders nothing for a row without an id', () => {
        const { container } = render(<DeviceOperationUtilization perfId={null} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('fetches the row only once the panel is opened', async () => {
        render(<DeviceOperationUtilization perfId={2} />);

        expect(useOperationHardwareCounters).not.toHaveBeenCalled();

        await openPopover(utilizationTrigger());

        expect(useOperationHardwareCounters).toHaveBeenCalledWith(2);
        expect(await screen.findByTestId(TEST_IDS.HARDWARE_COUNTER_PANEL)).toBeInTheDocument();
    });

    it('shows a spinner rather than the panel while the counters load', async () => {
        (useOperationHardwareCounters as Mock).mockReturnValue({ data: undefined, error: null, isLoading: true });
        render(<DeviceOperationUtilization perfId={2} />);

        await openPopover(utilizationTrigger());

        expect(document.querySelector('.hardware-counter-popover .loading-spinner')).not.toBeNull();
        expect(screen.queryByTestId(TEST_IDS.HARDWARE_COUNTER_PANEL)).toBeNull();
    });

    it('names the device in the panel it opens on a report of several devices', async () => {
        (useOperationHardwareCounters as Mock).mockReturnValue({
            data: { ...MATMUL, device_id: 1 },
            error: null,
            isLoading: false,
        });
        render(
            <DeviceOperationUtilization
                perfId={2}
                isMultiDevice
            />,
        );

        await openPopover(utilizationTrigger());

        expect(await screen.findByTestId(TEST_IDS.HARDWARE_COUNTER_DEVICE)).toHaveTextContent('Device 1');
    });

    it('records each opening of the panel as a drilldown, and a close as nothing', async () => {
        render(<DeviceOperationUtilization perfId={2} />);
        const trigger = utilizationTrigger();

        await openPopover(trigger);

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.DRILLDOWN_OPENED,
            details: { drilldown_target: DrilldownTarget.HARDWARE_COUNTERS },
        });

        // Blueprint ignores a synthetic click on its open trigger, so close it from outside as a user can.
        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));

        expect(recordEvent).toHaveBeenCalledTimes(1);

        await openPopover(trigger);

        expect(recordEvent).toHaveBeenCalledTimes(2);
    });

    it('says why when the counters cannot be loaded', async () => {
        (useOperationHardwareCounters as Mock).mockReturnValue({
            data: undefined,
            error: new Error('No performance row 2.'),
            isLoading: false,
        });
        render(<DeviceOperationUtilization perfId={2} />);

        await openPopover(utilizationTrigger());

        expect(await screen.findByText('No performance row 2.')).toBeInTheDocument();
    });
});
