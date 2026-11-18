// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationDetailsComponent from '../src/components/operation-details/OperationDetailsComponent';
import SideNavigation from '../src/components/SideNavigation';
import { BufferType } from '../src/model/BufferType';
import { dismissToast } from '../src/functions/createToastNotification';
import { activeToastAtom, selectedAddressAtom, selectedBufferColourAtom, selectedTensorIdAtom } from '../src/store/app';
import { summariseOperationBuffers } from '../src/functions/summariseOperationBuffers';
import { TestProviders } from './helpers/TestProviders';
import type { AtomProviderInitialValues } from './helpers/atomProvider';
import { BufferFocusProbe } from './helpers/BufferFocusProbe';
import { getBufferFocusProbe, pressAndRelease } from './helpers/bufferFocus';
import {
    buildBufferData,
    buildOperationDescription,
    buildOperationDetailsData,
    buildTensor,
} from './helpers/operationDetailsFixtures';
import { DrilldownTarget, EventLogEvent } from '../src/definitions/EventLogEvent';
import type { PlotMouseEventCustom } from '../src/model/PlotData';

const { recordEvent, stackTraceProps, plotProps } = vi.hoisted(() => ({
    recordEvent: vi.fn(),
    stackTraceProps: [] as Record<string, unknown>[],
    // The latest props each plot was given: their clicks come from Plotly, which jsdom
    // cannot drive, so the spec calls the handlers the page passes down.
    plotProps: {} as Partial<Record<'l1' | 'dram', Record<string, (...args: never[]) => void>>>,
}));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

const ADDRESS = 0x4000;
const OPERATION_ID = 1;
const TENSOR_ID = 10;
const COLOUR = '#4e79a7';
const BUFFER_FOCUS: AtomProviderInitialValues = [
    [activeToastAtom, 'buffer-toast'],
    [selectedTensorIdAtom, TENSOR_ID],
    [selectedAddressAtom, ADDRESS],
    [selectedBufferColourAtom, COLOUR],
];

function inputTensor() {
    return buildTensor({ id: TENSOR_ID, address: ADDRESS, buffer_type: BufferType.L1, producers: [0] });
}

function inputBuffers() {
    return [buildBufferData({ address: ADDRESS, buffer_type: BufferType.L1, max_size_per_bank: 4096 })];
}

vi.mock('../src/hooks/useAPI', () => ({
    useGetClusterDescription: () => ({ data: undefined }),
    useOperationsList: () => ({
        data: [
            buildOperationDescription({ id: 0, name: 'producer', outputs: [inputTensor()] }),
            buildOperationDescription({ id: OPERATION_ID, name: 'consumer', inputs: [inputTensor()] }),
        ],
    }),
    useGetL1StartMarker: () => 0,
    useGetL1SmallMarker: () => 1_500_000,
    useTensors: () => ({ data: [] }),
    useOperationDetails: (operationId: number) => ({
        operationDetails: {
            data: buildOperationDetailsData({
                id: operationId,
                inputs: [inputTensor()],
                buffers: inputBuffers(),
                buffersSummary: summariseOperationBuffers(inputBuffers()),
                stack_trace: 'frame 0\nframe 1',
            }),
            isLoading: false,
            status: 'success',
        },
    }),
    usePreviousOperationDetails: (operationId: number) => ({
        operationDetails: { data: buildOperationDetailsData({ id: operationId - 1 }), isLoading: false },
    }),
    useGetTensorDeallocationReportByOperation: () => ({
        lateDeallocationsByOperation: new Map(),
        nonDeallocatedTensorList: new Map(),
        status: 'success',
        operationRange: null,
    }),
}));

vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock();
});

// The tensor list stays real: its tensor control is the button that starts the focus.
vi.mock('../src/components/operation-details/L1Plots', () => ({
    default: (props: Record<string, (...args: never[]) => void>) => {
        plotProps.l1 = props;

        return null;
    },
}));
vi.mock('../src/components/operation-details/DRAMPlots', () => ({
    default: (props: Record<string, (...args: never[]) => void>) => {
        plotProps.dram = props;

        return null;
    },
}));
vi.mock('../src/components/operation-details/MemoryPlotRenderer', () => ({ default: () => null }));
// Captures its props: the page's trace is the one most stack-trace drill-downs come from.
vi.mock('../src/components/operation-details/StackTrace', () => ({
    default: (props: Record<string, unknown>) => {
        stackTraceProps.push(props);

        return null;
    },
}));
vi.mock('../src/components/operation-details/DeviceOperationsGraphComponent', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsFullRender', () => ({ default: () => null }));
vi.mock('../src/components/OperationArguments', () => ({ default: () => null }));
vi.mock('../src/components/OperationDetailsNavigation', () => ({ default: () => null }));
vi.mock('../src/components/tensor-sharding-visualization/TensorVisualisationComponent', () => ({
    default: () => null,
}));

// The rail sits beside the page, as in `Layout`, so a click on it is one the page has to judge.
const renderPage = (focus: AtomProviderInitialValues = BUFFER_FOCUS) =>
    render(
        <TestProviders initialAtomValues={focus}>
            <SideNavigation />
            <OperationDetailsComponent operationId={OPERATION_ID} />
            <BufferFocusProbe />
        </TestProviders>,
    );

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('OperationDetailsComponent and a focused buffer (#2042)', () => {
    it('keeps the focus its click sets, and dismisses it with its colour and toast on the next click on content', () => {
        // The listener attaches only once the focus exists, so the click that sets it is never judged.
        renderPage([]);
        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');

        pressAndRelease(screen.getByRole('button', { name: new RegExp(`Tensor ID: ${TENSOR_ID}`) }));
        expect(getBufferFocusProbe()).toHaveTextContent('focused');

        pressAndRelease(screen.getByRole('heading', { name: 'L1 Memory' }));
        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
        expect(dismissToast).toHaveBeenCalledExactlyOnceWith('mock-toast-id');
    });

    it('keeps it through a click on a control, which acts on its own', () => {
        renderPage();

        pressAndRelease(screen.getByRole('button', { name: 'DRAM' }));

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('keeps it through a click on the memory zoom range label, as on any label', () => {
        renderPage();

        pressAndRelease(screen.getByText(/L1 memory zoom range/));

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('dismisses it from blank space in the navigation rail, which the overlay never covered', () => {
        renderPage();

        pressAndRelease(screen.getByRole('navigation', { name: 'Main navigation' }));

        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
        expect(dismissToast).toHaveBeenCalledExactlyOnceWith('buffer-toast');
    });

    it('keeps it through a click in the panel describing the focused tensor', () => {
        renderPage();

        pressAndRelease(screen.getByRole('heading', { name: `Tensor ${TENSOR_ID}` }));

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });
});

describe('OperationDetailsComponent tensor drill-down event', () => {
    it('records opening the allocation per core of an L1 tensor', () => {
        renderPage([]);

        fireEvent.click(screen.getByRole('button', { name: 'Tensor allocation per core' }));

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.DRILLDOWN_OPENED,
            details: { drilldown_target: DrilldownTarget.TENSOR_DETAILS },
        });
    });

    it("marks the operation's stack trace as one whose expansion records a drill-down", () => {
        stackTraceProps.length = 0;
        renderPage([]);

        expect(stackTraceProps.at(-1)).toMatchObject({ stackTrace: 'frame 0\nframe 1', recordsExpansion: true });
    });
});

describe('OperationDetailsComponent buffer drill-down events', () => {
    const BUFFER_DETAILS = {
        event: EventLogEvent.DRILLDOWN_OPENED,
        details: { drilldown_target: DrilldownTarget.BUFFER_DETAILS },
    };

    const plotClick = (hovertemplate = '') =>
        ({
            points: [{ data: { hovertemplate, memoryData: { address: ADDRESS, tensor: inputTensor() } } }],
        }) as unknown as PlotMouseEventCustom;

    // Through a cast: each prop is a handler of its own signature.
    const callPlotHandler = (plot: 'l1' | 'dram', handler: string, ...args: unknown[]) =>
        act(() => (plotProps[plot]![handler] as (...handlerArgs: unknown[]) => void)(...args));

    const showDram = () => fireEvent.click(screen.getByRole('button', { name: 'DRAM' }));

    it('records one for a click on a tensor', () => {
        renderPage([]);

        pressAndRelease(screen.getByRole('button', { name: new RegExp(`Tensor ID: ${TENSOR_ID}`) }));

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(BUFFER_DETAILS);
    });

    it.each<[string, 'l1' | 'dram', string, () => unknown[]]>([
        ['an L1 buffer', 'l1', 'onBufferClick', () => [plotClick()]],
        ['an L1 legend entry', 'l1', 'onLegendClick', () => [ADDRESS, TENSOR_ID]],
        ['a DRAM buffer', 'dram', 'onDramBufferClick', () => [plotClick()]],
        ['a DRAM delta', 'dram', 'onDramDeltaClick', () => [plotClick()]],
        ['a DRAM legend entry', 'dram', 'onLegendClick', () => [ADDRESS, TENSOR_ID]],
    ])('records one for a click on %s', (_case, plot, handler, args) => {
        renderPage([]);
        if (plot === 'dram') {
            showDram();
        }

        callPlotHandler(plot, handler, ...args());

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(BUFFER_DETAILS);
    });

    it('records nothing for a click on the circular-buffer summary, which focuses nothing', () => {
        renderPage([]);

        callPlotHandler('l1', 'onBufferClick', plotClick('CBs Summary'));

        expect(recordEvent).not.toHaveBeenCalled();
    });
});
