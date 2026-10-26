// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeviceOperationsFullRender from '../src/components/operation-details/DeviceOperationsFullRender';
import { Node, NodeType } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { OperationDetails } from '../src/model/OperationDetails';
import { getTensorColor } from '../src/functions/colorGenerator';
import { summariseOperationBuffers } from '../src/functions/summariseOperationBuffers';
import {
    buildBufferData,
    buildOperationDescription,
    buildOperationDetails,
    buildTensor,
} from './helpers/operationDetailsFixtures';
import { ReportLinkMatchResult } from '../src/definitions/ReportLinks';
import { DeviceOperationPerf } from '../src/hooks/useDeviceOperationPerf';
import { enrichRowData } from '../src/functions/enrichPerfRowData';
import { PerfTableRow } from '../src/model/PerfTable';
import { TestProviders } from './helpers/TestProviders';
import { makeRawPerfRow } from './helpers/perfRowFixtures';

// The always-mounted `CircularBufferPressureModal` is the subtree's only API caller.
const mockUseDevices = vi.fn();
vi.mock('../src/hooks/useAPI.tsx', () => ({
    useDevices: () => mockUseDevices(),
}));

const mockUseDeviceOperationPerf = vi.fn();
vi.mock('../src/hooks/useDeviceOperationPerf', () => ({
    useDeviceOperationPerf: () => mockUseDeviceOperationPerf(),
}));

// Unless a case says otherwise, the linked performance report never arrives and no perf renders.
const PERF_LOADING: DeviceOperationPerf = {
    linkStatus: ReportLinkMatchResult.PENDING,
    hasPerformanceReport: false,
    rowByStartNodeId: new Map(),
    totalDeviceTimeUs: 0,
};

// Unsorted, as a real capture emits them, so nothing here can lean on ascending
// order. The sequence recorded in #1844.
const MESH_DEVICE_IDS = [6, 4, 5, 7, 3, 2, 0, 1];
const CORE_RANGE = '{[(x=0,y=0) - (x=1,y=0)]}';

let nextId = 0;

function mkNode<T extends Partial<Node>>(node: T): Node {
    nextId += 1;
    return {
        id: nextId,
        connections: [],
        inputs: [],
        outputs: [],
        ...node,
    } as Node;
}

function captureStart(): Node {
    return mkNode({ node_type: NodeType.capture_start, params: { name: 'capture' } } as unknown as Partial<Node>);
}

// No `stacking_level` unless given, as in most captures.
function functionStart(name: string, stackingLevel?: number): Node {
    return mkNode({
        node_type: NodeType.function_start,
        params: { name },
        ...(stackingLevel !== undefined && { stacking_level: stackingLevel }),
    } as unknown as Partial<Node>);
}

function functionEnd(
    name: string,
    extra: { aborted?: string; abort_reason?: string } = {},
    stackingLevel?: number,
): Node {
    return mkNode({
        node_type: NodeType.function_end,
        params: { name, ...extra },
        ...(stackingLevel !== undefined && { stacking_level: stackingLevel }),
    } as unknown as Partial<Node>);
}

function cbAllocate(size: number, address: number, deviceId?: number): Node {
    return mkNode({
        node_type: NodeType.circular_buffer_allocate,
        params: {
            core_range_set: CORE_RANGE,
            size: String(size),
            address: String(address),
            num_cores: '2',
            globally_allocated: '0',
            ...(deviceId !== undefined && { device_id: deviceId }),
        },
    } as unknown as Partial<Node>);
}

function cbDeallocateAll(): Node {
    return mkNode({ node_type: NodeType.circular_buffer_deallocate_all, params: {} } as unknown as Partial<Node>);
}

function meshGraph(sizes: { size: number; address: number }[], deviceIds: (number | undefined)[]): Node[] {
    const cbs = sizes.flatMap(({ size, address }) => deviceIds.map((id) => cbAllocate(size, address, id)));
    return [captureStart(), functionStart('MeshOp'), ...cbs, cbDeallocateAll(), functionEnd('MeshOp')];
}

const details = {
    l1_sizes: [1_000_000],
    getTensorForAddress: () => undefined,
    getTensorForNode: () => undefined,
    getTensorProducerConsumer: () => [],
} as unknown as OperationDetails;

function renderGraph(graph: Node[], hasRecordedError = false, operationDetails: OperationDetails = details) {
    const { container } = render(
        <TestProviders>
            <DeviceOperationsFullRender
                deviceOperations={graph}
                details={operationDetails}
                onLegendClick={vi.fn()}
                hasRecordedError={hasRecordedError}
            />
        </TestProviders>,
    );
    return container;
}

const legendRows = (container: HTMLElement) => container.querySelectorAll('.memory-legend-row');
const peakLoad = (container: HTMLElement) => container.querySelector('.peak-load .format-numbers')?.textContent;

beforeEach(() => {
    nextId = 0;
    mockUseDevices.mockReturnValue({ data: [{ num_x_cores: 2, num_y_cores: 2, worker_l1_size: 1_000_000 }] });
    mockUseDeviceOperationPerf.mockReturnValue(PERF_LOADING);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('DeviceOperationsFullRender - per-device CB fan-out (#1844)', () => {
    const TWO_CBS = [
        { size: 4096, address: 0x1000 },
        //
        { size: 2048, address: 0x2000 },
    ];

    it('renders one row per logical CB rather than one per device', () => {
        const container = renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));

        // 2 CBs x 8 devices = 16 allocate nodes in the graph.
        expect(legendRows(container)).toHaveLength(2);
    });

    it('labels each collapsed row with the number of devices behind it', () => {
        const container = renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));

        const labels = [...legendRows(container)].map((row) => row.textContent);
        expect(labels.every((text) => text?.includes('x 8 devices'))).toBe(true);
    });

    it('emits the CBs heading once even though later devices are skipped', () => {
        const container = renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));

        // Skipping a row must not clear the heading latch, or each skipped
        // device opens a fresh "CBs" section.
        expect(container.querySelectorAll('.cbs-heading')).toHaveLength(1);
    });

    it('reports the same peak L1 load as the equivalent single-device graph', () => {
        const mesh = renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));
        const meshPeak = peakLoad(mesh);
        cleanup();

        nextId = 0;
        const single = renderGraph(meshGraph(TWO_CBS, [0]));

        expect(meshPeak).toBe(peakLoad(single));
        // Guards against both readings being an empty/absent heading.
        expect(meshPeak).toMatch(/\d/);
    });

    it('keeps a repeat allocation on the same device as its own row', () => {
        const container = renderGraph(meshGraph([{ size: 4096, address: 0x1000 }], [0, 0]));

        expect(legendRows(container)).toHaveLength(2);
        expect([...legendRows(container)].some((row) => row.textContent?.includes('devices'))).toBe(false);
    });

    it('renders one row per CB and no device label when the graph carries no device_id', () => {
        const container = renderGraph(meshGraph(TWO_CBS, [undefined]));

        expect(legendRows(container)).toHaveLength(2);
        expect([...legendRows(container)].some((row) => row.textContent?.includes('devices'))).toBe(false);
    });

    // The snapshot reaches the modal only through this button, so without
    // opening it nothing would catch the wrong DeviceOp being wired up.
    // The dialog renders through a portal, so its rows are not under `container`.
    const openPressureModal = () => {
        fireEvent.click(screen.getByRole('button', { name: /View per-core allocations/ }));
        return document.querySelectorAll('.cb-row');
    };

    it('carries the collapsed device counts through to the pressure modal', () => {
        renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));

        const rows = openPressureModal();
        expect(rows).toHaveLength(2);
        expect([...rows].every((row) => /x 8 devices/.test(row.textContent ?? ''))).toBe(true);
    });

    it("shows a DeviceOp's own CBs, not the previous one's, in capture order (#2185)", () => {
        // In raw capture order a DeviceOp frees before it allocates, so the second
        // DeviceOp's free releases the first's CBs. The app sorts each free after
        // its CBs before rendering; this pins the raw order the port reads.
        const graph = [
            captureStart(),
            functionStart('Embeddings'),
            cbDeallocateAll(),
            cbAllocate(1024, 0x1000, 0),
            functionEnd('Embeddings'),
            functionStart('Embeddings'),
            cbDeallocateAll(),
            cbAllocate(2048, 0x2000, 1),
            functionEnd('Embeddings'),
        ];
        renderGraph(graph);

        const buttons = screen.getAllByRole('button', { name: /View per-core allocations/ });
        expect(buttons).toHaveLength(2);
        fireEvent.click(buttons[1]);

        const rows = [...document.querySelectorAll('.cb-row')].map((row) => row.textContent ?? '');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatch(/2 KiB/);
    });

    it('counts devices per CB in the modal rather than applying one count to all', () => {
        // dev0 allocates both CBs, dev1 only the first, so a blanket count would
        // pass a homogeneous fixture but not this one.
        const shared = { size: 4096, address: 0x1000 };
        const dev0Only = { size: 2048, address: 0x2000 };
        const graph = [
            captureStart(),
            functionStart('MeshOp'),
            cbAllocate(shared.size, shared.address, 0),
            cbAllocate(dev0Only.size, dev0Only.address, 0),
            cbAllocate(shared.size, shared.address, 1),
            cbDeallocateAll(),
            functionEnd('MeshOp'),
        ];
        renderGraph(graph);

        const rows = [...openPressureModal()].map((row) => row.textContent ?? '');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatch(/x 2 devices/);
        expect(rows[1]).not.toMatch(/devices/);
    });
});

describe('DeviceOperationsFullRender - failed device operations', () => {
    const labels = (container: HTMLElement) =>
        [...container.querySelectorAll('.device-operation-label')].map((label) => ({
            name: label.textContent?.split(' ')[0],
            isFailed: label.classList.contains('failed-scope'),
        }));

    // How many scopes enclose each label, in render order.
    const depths = (container: HTMLElement) =>
        [...container.querySelectorAll('.device-operation-label')].map((label) => {
            let depth = 0;

            for (let element = label.parentElement; element; element = element.parentElement) {
                if (element.classList.contains('function-content')) {
                    depth += 1;
                }
            }

            return { name: label.textContent?.split(' ')[0], depth };
        });

    const hoverIconOf = (container: HTMLElement, name: string) => {
        const label = [...container.querySelectorAll('.device-operation-label')].find((element) =>
            element.textContent?.startsWith(name),
        );
        fireEvent.mouseEnter(label!.querySelector('.operation-icon')!);
    };

    it('marks a scope that ended aborted as failed', () => {
        const container = renderGraph(
            [captureStart(), functionStart('Conv2d'), functionEnd('Conv2d', { aborted: 'true' })],
            true,
        );

        expect(labels(container)).toEqual([{ name: 'Conv2d', isFailed: true }]);
    });

    it('still renders what an unclosed scope allocated before it threw', () => {
        const container = renderGraph([captureStart(), functionStart('Conv2d'), cbAllocate(4096, 0x1000)], true);

        expect(labels(container)).toEqual([{ name: 'Conv2d', isFailed: true }]);
        expect(legendRows(container)).toHaveLength(1);
    });

    it('closes the outer scope at its own end when an inner scope never closed', () => {
        const container = renderGraph(
            [
                captureStart(),
                functionStart('ttnn.conv2d'),
                cbAllocate(4096, 0x1000),
                functionStart('Conv2d'),
                cbAllocate(2048, 0x2000),
                functionEnd('ttnn.conv2d'),
            ],
            true,
        );

        expect(labels(container)).toEqual([
            { name: 'ttnn.conv2d', isFailed: false },
            { name: 'Conv2d', isFailed: true },
        ]);
        // Before, the outer end closed the inner frame and the outer one was dropped,
        // taking its own allocation with it.
        expect(legendRows(container)).toHaveLength(2);
    });

    it('does not call a scope failed when the capture was only cut off', () => {
        const container = renderGraph([captureStart(), functionStart('Conv2d'), cbAllocate(4096, 0x1000)]);

        expect(labels(container)).toEqual([{ name: 'Conv2d', isFailed: false }]);
        expect(legendRows(container)).toHaveLength(1);
    });

    it('ignores an aborted end left over from an earlier operation', () => {
        const container = renderGraph(
            [
                functionEnd('ttnn.matmul', { aborted: 'true' }),
                captureStart(),
                functionStart('Conv2d'),
                cbAllocate(4096, 0x1000),
                functionEnd('Conv2d'),
            ],
            true,
        );

        expect(labels(container)).toEqual([{ name: 'Conv2d', isFailed: false }]);
        expect(legendRows(container)).toHaveLength(1);
    });

    it('gives the reason tt-metal recorded for the abort', async () => {
        const container = renderGraph(
            [
                captureStart(),
                functionStart('Conv2d'),
                functionEnd('Conv2d', { aborted: 'true', abort_reason: 'Out of Memory: Not enough space' }),
            ],
            true,
        );

        hoverIconOf(container, 'Conv2d');

        expect(await screen.findByText('Out of Memory: Not enough space')).toBeInTheDocument();
    });

    it('says a device op failed to launch, and an enclosing scope did not complete', async () => {
        const container = renderGraph(
            [
                captureStart(),
                functionStart('ttnn.conv2d'),
                functionStart('Conv2d'),
                functionEnd('Conv2d', { aborted: 'true', abort_reason: '' }),
                functionEnd('ttnn.conv2d', { aborted: 'true' }),
            ],
            true,
        );

        hoverIconOf(container, 'Conv2d');
        expect(await screen.findByText('Launch failed before reaching the device')).toBeInTheDocument();

        hoverIconOf(container, 'ttnn.conv2d');
        expect(await screen.findByText('Did not complete: an error was raised inside it')).toBeInTheDocument();
    });

    it('closes a scope left open when a sibling starts, where the capture records stacking levels', () => {
        const container = renderGraph(
            [
                captureStart(),
                functionStart('ttnn.conv2d', 1),
                functionStart('Failed', 2),
                functionStart('Next', 2),
                cbAllocate(4096, 0x1000),
                cbDeallocateAll(),
                functionEnd('Next', {}, 2),
                functionEnd('ttnn.conv2d', {}, 1),
            ],
            true,
        );

        expect(depths(container)).toEqual([
            { name: 'ttnn.conv2d', depth: 0 },
            { name: 'Failed', depth: 1 },
            { name: 'Next', depth: 1 },
        ]);
        expect(labels(container)).toEqual([
            { name: 'ttnn.conv2d', isFailed: false },
            { name: 'Failed', isFailed: true },
            { name: 'Next', isFailed: false },
        ]);

        fireEvent.click(screen.getByRole('button', { name: /View per-core allocations/ }));

        expect(screen.getByText('Next · per-core CB allocations')).toBeInTheDocument();
    });

    it("heads a sibling's CBs afresh after a failed scope's CBs that were never deallocated", () => {
        renderGraph(
            [
                captureStart(),
                functionStart('ttnn.conv2d', 1),
                functionStart('Failed', 2),
                cbAllocate(2048, 0x2000),
                functionStart('Next', 2),
                cbAllocate(4096, 0x1000),
                cbDeallocateAll(),
                functionEnd('Next', {}, 2),
                functionEnd('ttnn.conv2d', {}, 1),
            ],
            true,
        );

        expect(screen.getAllByText('CBs', { selector: 'h4' })).toHaveLength(2);

        const viewButtons = screen.getAllByRole('button', { name: /View per-core allocations/ });
        fireEvent.click(viewButtons[viewButtons.length - 1]);

        expect(screen.getByText('Next · per-core CB allocations')).toBeInTheDocument();
    });

    it('nests the scope after one left open, where the capture records no stacking levels', () => {
        const container = renderGraph(
            [
                captureStart(),
                functionStart('ttnn.conv2d'),
                functionStart('Failed'),
                functionStart('Next'),
                cbAllocate(4096, 0x1000),
                cbDeallocateAll(),
                functionEnd('Next'),
                functionEnd('ttnn.conv2d'),
            ],
            true,
        );

        expect(depths(container)).toEqual([
            { name: 'ttnn.conv2d', depth: 0 },
            { name: 'Failed', depth: 1 },
            { name: 'Next', depth: 2 },
        ]);

        fireEvent.click(screen.getByRole('button', { name: /View per-core allocations/ }));

        expect(screen.getByText('Next · per-core CB allocations')).toBeInTheDocument();
    });

    it('closes a crossed inner scope with its outer one, and skips its own end', () => {
        const container = renderGraph(
            [
                captureStart(),
                functionStart('ttnn.conv2d'),
                functionStart('Conv2d'),
                cbAllocate(4096, 0x1000),
                functionEnd('ttnn.conv2d'),
                functionEnd('Conv2d'),
            ],
            true,
        );

        expect(labels(container)).toEqual([
            { name: 'ttnn.conv2d', isFailed: false },
            { name: 'Conv2d', isFailed: true },
        ]);
        expect(legendRows(container)).toHaveLength(1);
    });

    it('ignores a stray end that arrives while a scope is open', () => {
        const container = renderGraph(
            [
                captureStart(),
                functionStart('Conv2d'),
                functionEnd('ttnn.matmul', { aborted: 'true' }),
                cbAllocate(4096, 0x1000),
                functionEnd('Conv2d'),
            ],
            true,
        );

        expect(labels(container)).toEqual([{ name: 'Conv2d', isFailed: false }]);
        expect(depths(container)).toEqual([{ name: 'Conv2d', depth: 0 }]);
        expect(legendRows(container)).toHaveLength(1);
    });

    it('says the capture ended before a scope closed when no error was recorded', async () => {
        const container = renderGraph([captureStart(), functionStart('Conv2d'), cbAllocate(4096, 0x1000)]);

        hoverIconOf(container, 'Conv2d');

        expect(await screen.findByText('The capture ended before this scope closed')).toBeInTheDocument();
    });
});

// The tensor rows here are looked up by address, and L1 and DRAM can share one.
// A captured tensor node names no memory space itself, so its buffer decides. #2078
describe('DeviceOperationsFullRender - tensors at a shared L1/DRAM address (#2078)', () => {
    const SHARED_ADDRESS = 0x4000;
    const L1_TENSOR_ID = 10;
    const DRAM_TENSOR_ID = 20;
    const L1_SMALL_TENSOR_ID = 30;

    const buildSharedAddressDetails = () => {
        const buffers = [
            buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.DRAM, max_size_per_bank: 128 }),
            buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.L1, max_size_per_bank: 4096 }),
            buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.L1_SMALL, max_size_per_bank: 64 }),
        ];

        return buildOperationDetails({
            data: { id: 1, buffers, buffersSummary: summariseOperationBuffers(buffers) },
            operations: [
                buildOperationDescription({
                    id: 1,
                    outputs: [
                        buildTensor({ id: L1_TENSOR_ID, address: SHARED_ADDRESS, buffer_type: BufferType.L1 }),
                        buildTensor({ id: DRAM_TENSOR_ID, address: SHARED_ADDRESS, buffer_type: BufferType.DRAM }),
                        buildTensor({
                            id: L1_SMALL_TENSOR_ID,
                            address: SHARED_ADDRESS,
                            buffer_type: BufferType.L1_SMALL,
                        }),
                    ],
                }),
            ],
        });
    };

    // As captured: tensor and buffer nodes carry a numeric `buffer_type`, and
    // buffer nodes a string `type` that reads `'L1'` for L1 Small too.
    const tensorGraph = (
        tensorId: number,
        tensorParams: Record<string, unknown>,
        bufferParams: Record<string, unknown>,
    ): Node[] => {
        const buffer = mkNode({
            node_type: NodeType.buffer,
            params: { size: '128', device_id: 0, ...bufferParams },
        } as unknown as Partial<Node>);
        const tensor = mkNode({
            node_type: NodeType.tensor,
            params: {
                tensor_id: tensorId,
                address: String(SHARED_ADDRESS),
                shape: 'Shape([1, 32])',
                dtype: 'DataType.BFLOAT16',
                size: '128',
                ...tensorParams,
            },
            buffer: [buffer],
        } as unknown as Partial<Node>);

        return [captureStart(), { ...functionStart('Op'), inputs: [tensor] }, functionEnd('Op')];
    };

    const dramTensorGraph = () =>
        tensorGraph(DRAM_TENSOR_ID, { buffer_type: BufferType.DRAM }, { type: 'DRAM', buffer_type: BufferType.DRAM });

    const labelSquare = (container: HTMLElement) =>
        container.querySelector('.tensor-details-layout .memory-color-block');

    // Each case names the memory space in one place only, so each source is tested alone.
    it.each([
        ['its own numeric type', { buffer_type: BufferType.DRAM }, {}],
        ["its buffer's numeric type", {}, { buffer_type: BufferType.DRAM }],
        ["its buffer's string type", {}, { type: 'DRAM' }],
        // At least one capture stores the C++ enum name.
        ['the C++ enum name', { buffer_type: 'BufferType::DRAM' }, {}],
    ])('colours a DRAM tensor named by %s with its own tensor', (_label, tensorParams, bufferParams) => {
        // Resolved up front: colours are handed out in first-seen order.
        const dramColour = getTensorColor(DRAM_TENSOR_ID);
        const l1Colour = getTensorColor(L1_TENSOR_ID);
        const container = renderGraph(
            tensorGraph(DRAM_TENSOR_ID, tensorParams, bufferParams),
            false,
            buildSharedAddressDetails(),
        );

        expect(labelSquare(container)).toHaveStyle({ backgroundColor: dramColour });
        expect(labelSquare(container)).not.toHaveStyle({ backgroundColor: l1Colour });
    });

    it('colours an L1 Small tensor whose buffer reads L1 with its own tensor', () => {
        const l1SmallColour = getTensorColor(L1_SMALL_TENSOR_ID);
        const container = renderGraph(
            tensorGraph(L1_SMALL_TENSOR_ID, {}, { type: 'L1', buffer_type: BufferType.L1_SMALL }),
            false,
            buildSharedAddressDetails(),
        );

        expect(labelSquare(container)).toHaveStyle({ backgroundColor: l1SmallColour });
    });

    // A tensor node with its own address renders its buffer row from the node
    // itself, in the label's tooltip, so that path needs the buffer's space too.
    it('colours the DRAM tensor buffer row with its own tensor', async () => {
        const dramColour = getTensorColor(DRAM_TENSOR_ID);
        const container = renderGraph(dramTensorGraph(), false, buildSharedAddressDetails());

        fireEvent.mouseEnter(container.querySelector('.tensor-details-layout .has-tooltip')!);

        const tooltip = await screen.findByText((_content, element) =>
            Boolean(element?.classList.contains('arg-tensor-tooltip')),
        );
        expect(tooltip.querySelector('.memory-color-block')).toHaveStyle({ backgroundColor: dramColour });
    });

    // These rows carry no tensor id, so they resolve one from their own memory space.
    it.each([
        ['allocate', NodeType.buffer_allocate],
        ['deallocate', NodeType.buffer_deallocate],
    ])('colours a DRAM buffer %s row with the DRAM tensor at its address', (_label, nodeType) => {
        const dramColour = getTensorColor(DRAM_TENSOR_ID);
        const l1Colour = getTensorColor(L1_TENSOR_ID);
        const bufferNode = mkNode({
            node_type: nodeType,
            params: {
                address: String(SHARED_ADDRESS),
                size: '128',
                num_cores: '1',
                type: 'DRAM',
                buffer_type: BufferType.DRAM,
            },
        } as unknown as Partial<Node>);
        const container = renderGraph(
            [captureStart(), functionStart('Op'), bufferNode, functionEnd('Op')],
            false,
            buildSharedAddressDetails(),
        );

        const swatch = container.querySelector('.memory-legend-row .memory-color-block');
        expect(swatch).toHaveStyle({ backgroundColor: dramColour });
        expect(swatch).not.toHaveStyle({ backgroundColor: l1Colour });
    });
});

describe('DeviceOperationsFullRender - device operation perf (#1512)', () => {
    const perfRow = (id: string, rawOpCode: string, deviceTimeUs: string, cores: string) =>
        enrichRowData(
            [
                makeRawPerfRow({
                    id,
                    raw_op_code: rawOpCode,
                    device_time: deviceTimeUs,
                    cores,
                    bound: '' as PerfTableRow['bound'],
                    bound_analysis: 'none',
                }),
            ],
            [],
            null,
        )[0];

    const perfByScope = (container: HTMLElement) =>
        [...container.querySelectorAll('.device-operation-label')].map((label) => [
            label.textContent?.split(' ')[0],
            label.closest('.collapsible-controls')?.querySelector('.device-operation-perf')?.textContent ?? null,
        ]);

    it("shows each device operation's own row in its header, and none on a helper scope", () => {
        // ttnn.cumsum in bge_m3: the same device operation twice, each with its own row.
        const reshape = functionStart('Tensor::reshape');
        const firstPermute = functionStart('PermuteDeviceOperation');
        const accumulation = functionStart('AccumulationDeviceOperation');
        const secondPermute = functionStart('PermuteDeviceOperation');
        mockUseDeviceOperationPerf.mockReturnValue({
            linkStatus: ReportLinkMatchResult.LINKED,
            hasPerformanceReport: true,
            totalDeviceTimeUs: 50_000,
            rowByStartNodeId: new Map([
                [firstPermute.id, perfRow('5', 'PermuteDeviceOperation', '14.418', '64')],
                [accumulation.id, perfRow('6', 'AccumulationDeviceOperation', '115.73', '1')],
                [secondPermute.id, perfRow('7', 'PermuteDeviceOperation', '5.559', '32')],
            ]),
        });

        const container = renderGraph([
            captureStart(),
            reshape,
            functionEnd('Tensor::reshape'),
            firstPermute,
            functionEnd('PermuteDeviceOperation'),
            accumulation,
            functionEnd('AccumulationDeviceOperation'),
            secondPermute,
            functionEnd('PermuteDeviceOperation'),
        ]);

        expect(perfByScope(container)).toEqual([
            ['Tensor::reshape', null],
            ['PermuteDeviceOperation', '14 µs·64 cores·<0.1% of device time'],
            ['AccumulationDeviceOperation', '116 µs·1 core·0.2% of device time'],
            ['PermuteDeviceOperation', '6 µs·32 cores·<0.1% of device time'],
        ]);
        expect(container).toHaveTextContent(
            "3 device operations ran for 136 µs (0.3% of the report's device time). " +
                'Slowest: AccumulationDeviceOperation, 116 µs on 1 core.',
        );
    });

    const linkedTo = (scope: Node, row: ReturnType<typeof perfRow>): DeviceOperationPerf => ({
        linkStatus: ReportLinkMatchResult.LINKED,
        hasPerformanceReport: true,
        totalDeviceTimeUs: 50_000,
        rowByStartNodeId: new Map([[scope.id, row]]),
    });

    it("shows a scope's perf and its Arguments button together, and the button still opens", () => {
        const matmul = { ...functionStart('MatmulDeviceOperation'), arguments: ['Tensor(shape=[32, 32])'] } as Node;
        mockUseDeviceOperationPerf.mockReturnValue(linkedTo(matmul, perfRow('3', 'MatmulDeviceOperation', '40', '8')));

        const container = renderGraph([captureStart(), matmul, functionEnd('MatmulDeviceOperation')]);
        fireEvent.click(screen.getByRole('button', { name: /Arguments/ }));

        expect(perfByScope(container)).toEqual([['MatmulDeviceOperation', '40 µs·8 cores·<0.1% of device time']]);
        expect(document.querySelector('.device-operation-arguments-visualisation-overlay')).toHaveTextContent(
            'Tensor(shape = [32, 32])',
        );
    });

    it("shows a scope's perf with no Arguments button when it has no arguments", () => {
        const matmul = functionStart('MatmulDeviceOperation');
        mockUseDeviceOperationPerf.mockReturnValue(linkedTo(matmul, perfRow('3', 'MatmulDeviceOperation', '40', '8')));

        const container = renderGraph([captureStart(), matmul, functionEnd('MatmulDeviceOperation')]);

        expect(perfByScope(container)).toEqual([['MatmulDeviceOperation', '40 µs·8 cores·<0.1% of device time']]);
        expect(screen.queryByRole('button', { name: /Arguments/ })).not.toBeInTheDocument();
    });

    it('says so above the list when no performance report is loaded', () => {
        mockUseDeviceOperationPerf.mockReturnValue({ ...PERF_LOADING, linkStatus: ReportLinkMatchResult.UNAVAILABLE });

        const container = renderGraph([captureStart(), functionStart('Matmul'), functionEnd('Matmul')]);

        expect(container).toHaveTextContent('Load a performance report from the same run');
        expect(perfByScope(container)).toEqual([['Matmul', null]]);
    });

    it('says nothing about perf for an operation with only host-side scopes', () => {
        mockUseDeviceOperationPerf.mockReturnValue({ ...PERF_LOADING, linkStatus: ReportLinkMatchResult.UNAVAILABLE });

        const container = renderGraph([
            captureStart(),
            functionStart('Tensor::reshape'),
            functionEnd('Tensor::reshape'),
        ]);

        expect(container).not.toHaveTextContent('performance report');
    });
});
