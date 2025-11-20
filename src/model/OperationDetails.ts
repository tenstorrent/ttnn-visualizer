// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { formatSize, getCoresInRange, toHex } from '../functions/math';
import {
    BufferData,
    Chunk,
    DeviceOperation,
    DeviceOperationTypes,
    FragmentationEntry,
    Node,
    NodeType,
    OperationDescription,
    OperationDetailsData,
    Tensor,
} from './APIData';
import { BufferType } from './BufferType';
import { DRAM_MEMORY_SIZE } from '../definitions/DRAMMemorySize';
import { CONDENSED_PLOT_CHUNK_COLOR, PlotDataCustom, PlotDataOverrides } from '../definitions/PlotConfigurations';
import getChartData from '../functions/getChartData';
import { L1_DEFAULT_MEMORY_SIZE, L1_NUM_CORES } from '../definitions/L1MemorySize';
import { TensorDeallocationReport } from './BufferSummary';

export interface OperationDetailsOptions {
    renderPattern: boolean;
    lateDeallocation: boolean;
}

export class OperationDetails implements Partial<OperationDetailsData> {
    id: number;

    inputs: Tensor[];

    outputs: Tensor[];

    buffers: BufferData[];

    deviceBuffers: BufferData[];

    l1_sizes: number[];

    stack_trace: string;

    tensorList: Tensor[];

    raw_device_operations: Node[] = [];

    device_operations: Node[] = [];

    tensorListByAddress: Map<number, Tensor> = new Map();

    public tensorListById: Map<number, Tensor> = new Map();

    private operations: OperationDescription[] = [];

    private deallocationReport: TensorDeallocationReport[] = [];

    public deviceOperations: DeviceOperation[] = [];

    private memoryConfig: {
        l1start: number;
        l1end: number;
    };

    private options: OperationDetailsOptions = {
        renderPattern: false,
        lateDeallocation: false,
    };

    constructor(
        data: OperationDetailsData,
        operations: OperationDescription[],
        deallocationReport: TensorDeallocationReport[],
        memoryConfig: {
            l1start: number;
            l1end: number;
        },
        options?: OperationDetailsOptions,
    ) {
        this.id = data.id;
        this.inputs = data.inputs;
        this.outputs = data.outputs;
        // yes, this is confusing. we have to retain this functionality
        this.buffers = data.buffersSummary;
        this.deviceBuffers = data.buffers;
        this.l1_sizes = data.l1_sizes;
        this.stack_trace = data.stack_trace;
        this.operations = operations;
        this.raw_device_operations = data.device_operations;
        this.deallocationReport = deallocationReport;
        // DEBUG
        // this.device_operations = this.preprocessConnections(data.device_operations); // // this.mergeDevices(this.preprocessConnections(data.device_operations));
        this.device_operations = this.mergeDevices(this.preprocessConnections(data.device_operations));
        this.options = options || { renderPattern: false, lateDeallocation: false };
        this.memoryConfig = memoryConfig;

        this.inputs.forEach((tensor) => {
            tensor.producerNames = tensor.producers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.consumerNames = tensor.consumers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.operationIdentifier = tensor.producers
                .map((op) => {
                    return this.operations.find((operation) => operation.id === op)?.operationFileIdentifier || '';
                })
                .join('');
        });

        this.outputs.forEach((tensor: Tensor) => {
            tensor.producerNames = tensor.producers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.consumerNames = tensor.consumers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.operationIdentifier = this.operations.find(
                (operation) => operation.id === this.id,
            )?.operationFileIdentifier;
        });

        this.tensorList =
            [
                [
                    ...(this.inputs.map((input) => {
                        return { ...input, io: 'input' } as Tensor;
                    }) || []),
                ],
                [
                    ...(this.outputs.map((output) => {
                        return { ...output, io: 'output' } as Tensor;
                    }) || []),
                ],
            ].flat() || [];

        this.tensorListByAddress = this.getTensorListByAddress();
        this.tensorListByAddress.forEach((tensor) => {
            tensor.producerNames = tensor.producers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.consumerNames = tensor.consumers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
        });
        this.tensorListById = new Map(
            Array.from(this.tensorListByAddress.values()).map((tensor) => [tensor.id, tensor]),
        );

        const deviceOpList: Node[] = [];
        if (this.device_operations !== null) {
            this.device_operations = this.sortDeviceOperationsByBufferDeallocation(this.device_operations);

            this.device_operations.forEach((node) => {
                if (node.node_type === NodeType.function_start) {
                    this.deviceOperations.push({
                        name: node.params.name,
                        cbList: [],
                        bufferList: [],
                        deallocateCBs: false,
                        deallocateBuffers: false,
                        tensor: undefined,
                        events: [],
                        id: node.id,
                    });
                    deviceOpList.push(node);
                }
                if (node.node_type === NodeType.function_end) {
                    deviceOpList.pop();
                }
                if (node.node_type === NodeType.circular_buffer_allocate) {
                    const deviceOpNode = deviceOpList.at(-1);
                    if (deviceOpNode) {
                        const deviceOp = this.deviceOperations
                            .slice()
                            .reverse()
                            .find((op) => op.name === deviceOpNode.params.name);

                        if (deviceOp) {
                            deviceOp.cbList.push({
                                address: parseInt(node.params.address, 10),
                                size: parseInt(node.params.size, 10),
                                core_range_set: node.params.core_range_set,
                                num_cores: getCoresInRange(node.params.core_range_set),
                                colorVariance: deviceOp.id,
                            });
                        }
                    }
                }

                if (node.node_type === NodeType.circular_buffer_deallocate_all) {
                    // noop
                }
                if (node.node_type === NodeType.buffer_allocate) {
                    const deviceOpNode = deviceOpList.at(-1);
                    if (deviceOpNode) {
                        const deviceOp = this.deviceOperations
                            .slice()
                            .reverse()
                            .find((op) => op.name === deviceOpNode.params.name);

                        if (deviceOp) {
                            if (node.params.type === DeviceOperationTypes.L1) {
                                const cores = parseInt(node.params.num_cores, 10) || L1_NUM_CORES;
                                deviceOp.bufferList.push({
                                    address: parseInt(node.params.address, 10),
                                    size: parseInt(node.params.size, 10) / cores,
                                    layout: node.params.layout,
                                    type: node.params.type,
                                });
                            }
                        }
                    }
                }
                if (node.node_type === NodeType.tensor) {
                    const deviceOpNode = deviceOpList.at(-1);
                    if (deviceOpNode) {
                        const deviceOp = this.deviceOperations
                            .slice()
                            .reverse()
                            .find((op) => op.name === deviceOpNode.params.name);

                        if (deviceOp) {
                            deviceOp.tensor = { shape: node.params.shape, id: node.params.tensor_id };
                        }
                    }
                }

                if (node.node_type === NodeType.buffer_deallocate) {
                    // noop
                }
            });
        }

        this.getGroupedMemoryReport = this.getGroupedMemoryReport.bind(this);
    }

    private getChartData(memory: Chunk[], overrides?: PlotDataOverrides): Partial<PlotData>[] {
        return getChartData(memory, this.getTensorForAddress.bind(this), overrides, this.options);
    }

    get memorySizeL1(): number {
        // TODO: memorysize will need to be read from the appropriate device even though its likely going to be the same for the multichip scenario
        return this.l1_sizes?.[0] || L1_DEFAULT_MEMORY_SIZE;
    }

    getTensorForAddress(address: number): Tensor | null {
        return this.tensorListByAddress.get(address) || null;
    }

    getTensorProducerConsumer(id: number | null) {
        if (id === null) {
            return { producers: [], consumers: [] };
        }

        let tensor: Tensor | undefined = this.tensorList.find((t) => t.id === id);

        if (!tensor) {
            tensor = this.tensorListById.get(id);
            if (!tensor) {
                return { producers: [], consumers: [] };
            }
        }

        return {
            producers: tensor.producers.map((op, index) => ({
                id: op,
                name: tensor?.producerNames[index],
            })),
            consumers: tensor.consumers.map((op, index) => ({
                id: op,
                name: tensor?.consumerNames[index],
            })),
        };
    }

    getGroupedMemoryReport(bufferType: BufferType) {
        const groupedMap = new Map<number, FragmentationEntry[]>();

        this.deviceBuffers
            .filter((buffer) => buffer.buffer_type === bufferType)
            .forEach((buffer) => {
                const entry: FragmentationEntry = {
                    ...buffer,
                    size: buffer.max_size_per_bank,
                };

                if (groupedMap.has(entry.address)) {
                    groupedMap.get(entry.address)?.push(entry);
                } else {
                    groupedMap.set(entry.address, [entry]);
                }
            });

        return groupedMap;
    }

    memoryData(bufferType: BufferType = BufferType.L1): {
        chartData: Partial<PlotDataCustom>[];
        memory: Chunk[];
        fragmentation: FragmentationEntry[];
        condensed: Chunk;
        condensedChart: Partial<PlotData>[];
        cbChartData: Partial<PlotData>[];
        cbChartDataByOperation: Map<{ name: string; index: number }, Partial<PlotData>[]>;
        cbMemory: Chunk[];
        bufferChartData: Partial<PlotData>[];
        bufferChartDataByOperation: Map<{ name: string; index: number }, Partial<PlotData>[]>;
        bufferMemory: Chunk[];
    } {
        const fragmentation: FragmentationEntry[] = [];
        const memory: Chunk[] =
            this.buffers
                ?.filter((buffer: BufferData) => buffer.buffer_type === bufferType)
                .map((buffer: BufferData) => {
                    const lateDeallocation = this.deallocationReport.some(
                        (report) => report.address === buffer.address,
                    );

                    return {
                        address: buffer.address,
                        size: buffer.max_size_per_bank,
                        tensorId: this.getTensorForAddress(buffer.address)?.id,
                        lateDeallocation,
                    };
                })
                .sort((a, b) => a.address - b.address) || [];

        const cbMemory = bufferType === BufferType.L1 ? this.deviceOperations.flatMap((op) => op.cbList) : [];
        const bufferMemory =
            bufferType === BufferType.L1
                ? this.deviceOperations.flatMap((op) => op.bufferList).filter((op) => op.type === 'L1')
                : [];

        const totalMemory = [
            { address: 0, size: 0 },
            ...cbMemory,
            ...memory,
            ...bufferMemory,
            {
                address: this.memorySizeL1,
                size: 0,
            },
        ].sort((a, b) => a.address - b.address);

        const continuousMemory: Chunk[] = [];
        totalMemory.forEach((chunk) => {
            if (continuousMemory.length === 0) {
                continuousMemory.push({ ...chunk });
            } else {
                const lastChunk = continuousMemory[continuousMemory.length - 1];
                if (lastChunk.address + lastChunk.size >= chunk.address) {
                    lastChunk.size = Math.max(lastChunk.size, chunk.address + chunk.size - lastChunk.address);
                } else {
                    continuousMemory.push({ ...chunk });
                }
            }
        });

        if (bufferType === BufferType.L1) {
            continuousMemory.forEach((chunk, index) => {
                if (index > 0) {
                    let prevChunkIndex = index - 1;
                    let prevChunk = continuousMemory[prevChunkIndex];
                    while (prevChunkIndex >= 0 && prevChunk.address + prevChunk.size > chunk.address) {
                        prevChunkIndex--;
                        if (prevChunkIndex >= 0) {
                            prevChunk = continuousMemory[prevChunkIndex];
                        }
                    }
                    if (prevChunkIndex >= 0 && prevChunk.address + prevChunk.size < chunk.address) {
                        if (
                            prevChunk.address + prevChunk.size > this.memoryConfig.l1start &&
                            prevChunk.address < this.memoryConfig.l1end
                        ) {
                            fragmentation.push({
                                address: prevChunk.address + prevChunk.size,
                                size: chunk.address - (prevChunk.address + prevChunk.size),
                                empty: true,
                            });
                        } else if (prevChunk.address === 0 && prevChunk.size === 0) {
                            const address = this.memoryConfig.l1start ?? 0;
                            const size = chunk.address - address;
                            if (size > 0) {
                                fragmentation.push({
                                    address,
                                    size,
                                    empty: true,
                                });
                            }
                        }
                    }
                }
            });
        }
        const largestEmpty = fragmentation.length
            ? fragmentation.reduce((prev, current) => {
                  return prev.size > current.size ? prev : current;
              })
            : { size: 0 };

        fragmentation.forEach((fragment) => {
            if (fragment.size === largestEmpty.size) {
                fragment.largestEmpty = true;
            }
        });

        const condensed: Chunk = this.calculateCondensed(memory);
        const cbCondensed: Chunk = this.calculateCondensed(cbMemory);
        const bufferCondensed: Chunk = this.calculateCondensed(bufferMemory);

        const chartData = this.getChartData(memory);
        const cbColor = '#e2defc';
        const cbHoverTemplate = `
<span style="color:${cbColor};font-size:20px;">&#9632;</span>
${cbCondensed.address} (${toHex(cbCondensed.address)}) <br>Size: ${formatSize(cbCondensed.size)}
<br><br>CBs Summary
<extra></extra>`;

        const cbChartData = this.getChartData([cbCondensed], { color: cbColor, hovertemplate: cbHoverTemplate });
        const cbChartDataByOperation: Map<{ name: string; index: number }, Partial<PlotData>[]> = new Map();
        this.deviceOperations.forEach((op) => {
            if (op.cbList.length !== 0) {
                cbChartDataByOperation.set(
                    {
                        name: op.name,
                        index: op.id,
                    },
                    this.getChartData(op.cbList, { colorVariance: op.id }),
                );
            }
        });

        const bufferColor = '#fcdefa';
        const bufferHoverTemplate = `
<span style="color:${bufferColor};font-size:20px;">&#9632;</span>
${bufferCondensed.address} (${toHex(bufferCondensed.address)}) <br>Size: ${formatSize(bufferCondensed.size)}
<br><br>Buffers Summary
<extra></extra>`;
        const bufferChartData = this.getChartData([bufferCondensed], {
            color: bufferColor,
            hovertemplate: bufferHoverTemplate,
        });
        const bufferChartDataByOperation: Map<{ name: string; index: number }, Partial<PlotData>[]> = new Map();
        this.deviceOperations.forEach((op) => {
            if (op.bufferList.length !== 0 && op.bufferList[0].type === 'L1') {
                bufferChartDataByOperation.set(
                    {
                        name: op.name,
                        index: op.id,
                    },
                    this.getChartData(op.bufferList),
                );
            }
        });

        const condensedChart = this.getChartData([condensed]);

        if (condensedChart[0] !== undefined && bufferType === BufferType.L1_SMALL) {
            condensedChart[0].marker!.color = CONDENSED_PLOT_CHUNK_COLOR;
            condensedChart[0].hovertemplate = `
    <span style="color:${CONDENSED_PLOT_CHUNK_COLOR};font-size:20px;">&#9632;</span>
<br />
<span>L1 Small Condensed view</span>
<extra></extra>`;
        }

        return {
            chartData,
            memory,
            fragmentation,
            condensed,
            condensedChart,
            cbChartData,
            cbChartDataByOperation,
            cbMemory,
            bufferChartData,
            bufferChartDataByOperation,
            bufferMemory,
        };
    }

    public getMemoryDelta(delta1: Chunk[], delta2: Chunk[]) {
        const delta = delta1.length > 0 ? delta1 : delta2;

        return {
            chartData: this.getChartData(delta),
            // eslint-disable-next-line no-unsafe-optional-chaining
            min: delta[0]?.address - 10240 || 0,
            // eslint-disable-next-line no-unsafe-optional-chaining
            max: delta[delta.length - 1]?.address + delta[delta.length - 1]?.size + 10240 || DRAM_MEMORY_SIZE,
            memory: delta,
        };
    }

    private getTensorListByAddress() {
        const tensorsByBufferAddress: Map<number, Tensor> = new Map();

        const currentOperation = this.operations.find((op) => op.id === this.id);

        for (const buffer of this.buffers) {
            const bufferAddress = buffer.address;
            const bufferType = buffer.buffer_type;
            let tensor: Tensor | undefined;

            for (let i = this.operations.indexOf(currentOperation!); i >= 0; i--) {
                const op = this.operations[i];
                tensor = op.inputs.find((input) => input.address === bufferAddress);

                if (tensor !== undefined) {
                    break;
                }

                tensor = op.outputs.find((output) => output.address === bufferAddress);

                if (tensor !== undefined) {
                    break;
                }
            }

            if (tensor !== undefined) {
                tensorsByBufferAddress.set(bufferAddress, {
                    ...tensor,
                    buffer_type: bufferType,
                });
            }
        }

        return tensorsByBufferAddress;
    }

    // eslint-disable-next-line class-methods-use-this
    private calculateCondensed(mem: Chunk[]): Chunk {
        if (!mem || mem.length === 0) {
            return {
                address: 0,
                size: 0,
            };
        }
        let rangeEnd = 0;
        mem.forEach((chunk) => {
            rangeEnd = Math.max(rangeEnd, chunk.address + chunk.size);
        });
        return {
            address: mem[0].address || 0,
            size: rangeEnd - mem[0].address,
        };
    }

    // eslint-disable-next-line class-methods-use-this
    private preprocessConnections(ops: Node[]) {
        const captureStart = ops.find((op) => op.node_type === NodeType.capture_start);
        const operations: Node[] = ops.map((op) => ({ ...op, inputs: [], outputs: [] }));
        const getConnectedNodes = (node: Node): Node[] => {
            return node.connections
                .map((connection) => {
                    return operations.find((connectedNode) => connectedNode.id === connection);
                })
                .filter((n) => n) as Node[];
        };
        operations.forEach((op) => {
            if (op.node_type === NodeType.function_start) {
                // outputs
                op.outputs = getConnectedNodes(op).flatMap((node) => {
                    if (node?.node_type === NodeType.function_end) {
                        return getConnectedNodes(node).filter(
                            (out) =>
                                out?.node_type !== NodeType.capture_end && out?.node_type !== NodeType.function_start,
                        );
                    }
                    return [];
                });

                // connect end to start
                getConnectedNodes(op).forEach((n) => {
                    if (n.node_type === NodeType.function_end) {
                        n.operation = op;
                        n.params.device_id = op.params.device_id;
                    }
                });
            } else if (op.node_type === NodeType.buffer) {
                const connectedNodes = getConnectedNodes(op);
                connectedNodes.forEach((n) => {
                    if (n.node_type === NodeType.tensor) {
                        n.params.device_id = op.params.device_id;
                        if (!n.buffer) {
                            n.buffer = [];
                        }
                        const deviceId = (op.params.device_id as number) || 0;
                        n.buffer[deviceId] = op;
                    }
                });
            } else if (op.node_type === NodeType.buffer_allocate) {
                const connectedNodes = getConnectedNodes(op);
                connectedNodes.forEach((n) => {
                    if (n.node_type === NodeType.buffer) {
                        const deviceId = (op.params.device_id as number) || 0;
                        const bufferDeviceId = (n.params.device_id as number) || 0;
                        if (deviceId === bufferDeviceId) {
                            n.allocation = op;
                        }
                        // n.params.device_id = op.params.device_id;
                        // if (!n.allocation) {
                        //     n.allocation = [];
                        // }
                        // n.allocation.push(op);
                    }
                });
            } else if (op.node_type === NodeType.circular_buffer_allocate) {
                const numCores = getCoresInRange(op.params.core_range_set);
                op.params.num_cores = numCores.toString();
            } else if (op.node_type !== NodeType.function_end && op.node_type !== NodeType.capture_start) {
                // inputs reversed
                const connectedNodes = getConnectedNodes(op);
                connectedNodes.forEach((n) => {
                    if (n.node_type === NodeType.function_start) {
                        n.inputs.push(op);
                    }
                });
            }
        });
        operations
            .filter((op) => op.node_type === NodeType.function_start)
            .filter((op) => !captureStart?.connections.includes(op.id))
            .forEach((op) => {
                op.outputs.forEach((n) => {
                    if (n.node_type === NodeType.tensor) {
                        if (n.params.device_id !== undefined) {
                            // KEEPING in case device id arrays confirmed
                            // op.params.derived_device_id = [
                            //     ...new Set(op.params.derived_device_id || [n.params.device_id]),
                            // ];
                            op.params.device_id = n.params.device_id;
                        }
                    }
                });
            });
        return operations;
    }

    // eslint-disable-next-line class-methods-use-this
    private mergeDevices(operations: Node[]) {
        const multiDeviceOps: Node[] = [];
        const operationsByDevice: Map<string | number | undefined, Node[]> = new Map();
        let currentDeviceId: string | number | undefined;
        operations.forEach((op) => {
            if (op.node_type === NodeType.function_start) {
                const deviceId = Number(op.params.device_id);
                currentDeviceId = deviceId;
                if (op.params.device_id !== undefined) {
                    if (!operationsByDevice.has(deviceId)) {
                        operationsByDevice.set(deviceId, []);
                    }
                    operationsByDevice.get(deviceId)?.push(op);
                } else {
                    multiDeviceOps.push(op);
                }
            } else if (currentDeviceId !== undefined) {
                if (op.params.device_id === undefined) {
                    multiDeviceOps.push(op);
                } else {
                    operationsByDevice.get(currentDeviceId)?.push(op);
                }
            } else if (currentDeviceId === undefined && op.params.device_id !== undefined) {
                const deviceId = Number(op.params.device_id);

                if (!operationsByDevice.has(deviceId)) {
                    operationsByDevice.set(deviceId, []);
                }
                // PLO
                // galaxy
                // http://localhost:5173/operations/17
                // operationsByDevice.get(deviceId)?.push(op);
            } else {
                multiDeviceOps.push(op);
            }
        });

        const deviceIdList = [...operationsByDevice.keys()]
            .filter((el) => el !== undefined && el !== null)
            .map((el) => Number(el));

        const firstDevice = Math.min(...deviceIdList);

        const result: Node[] = [...multiDeviceOps, ...(operationsByDevice.get(firstDevice) || [])];
        result.sort((a, b) => a.id - b.id);
        return result;
    }

    // eslint-disable-next-line class-methods-use-this
    sortDeviceOperationsByBufferDeallocation(deviceOperations: Node[]): Node[] {
        const circularBufferDeallocations: Map<number, Node> = new Map();
        const nodes: Node[] = [];
        const opList: Node[] = [];

        for (const node of deviceOperations) {
            if (node.node_type === NodeType.function_start) {
                opList.push(node);
            }
            if (node.node_type === NodeType.function_end) {
                opList.pop();
            }
            if (node.node_type === NodeType.circular_buffer_deallocate_all) {
                const opId = opList.length > 0 ? opList[opList.length - 1].id : -1;
                circularBufferDeallocations.set(opId, node);
            } else {
                nodes.push(node);
            }
        }

        const sortedNodes: Node[] = [];
        nodes.forEach((node, index) => {
            sortedNodes.push(node);
            if (node.node_type === NodeType.function_start) {
                opList.push(node);
            }
            if (node.node_type === NodeType.function_end) {
                opList.pop();
            }
            if (node.node_type === NodeType.circular_buffer_allocate) {
                const nextNode = nodes[index + 1];
                const matchingDeallocate = circularBufferDeallocations.get(
                    opList.length > 0 ? opList[opList.length - 1].id : -1,
                );
                if (matchingDeallocate && nextNode && nextNode.node_type !== NodeType.circular_buffer_allocate) {
                    sortedNodes.push(matchingDeallocate);
                }
            }
        });
        return sortedNodes;
    }
}
