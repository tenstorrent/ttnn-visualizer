// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { getBufferColor } from '../functions/colorGenerator';
import { formatSize, toHex } from '../functions/math';
import {
    BufferData,
    Chunk,
    DeviceOperation,
    FragmentationEntry,
    Node,
    NodeType,
    OperationDescription,
    OperationDetailsData,
    TensorData,
} from './APIData';
import { BufferType } from './BufferType';
import { DRAM_MEMORY_SIZE } from '../definitions/DRAMMemorySize';
import { HistoricalTensor, Tensor } from './Graph';
import { PlotDataOverrides } from '../definitions/PlotConfigurations';

export class OperationDetails implements Partial<OperationDetailsData> {
    id: number;

    inputs: TensorData[];

    outputs: TensorData[];

    buffers: BufferData[];

    l1_sizes: number[];

    stack_trace: string;

    tensorList: TensorData[];

    device_operations: Node[] = [];

    private historicalTensorListByAddress: Map<number, HistoricalTensor> = new Map();

    private historicalTensorListById: Map<number, HistoricalTensor> = new Map();

    private operations: OperationDescription[] = [];

    public deviceOperations: DeviceOperation[] = [];

    constructor(data: OperationDetailsData, operations: OperationDescription[]) {
        this.id = data.id;
        this.inputs = data.inputs;
        this.outputs = data.outputs;
        this.buffers = data.buffers;
        this.l1_sizes = data.l1_sizes;
        this.stack_trace = data.stack_trace;
        this.operations = operations;
        this.device_operations = data.device_operations;

        this.inputs.forEach((tensor) => {
            tensor.producerNames = tensor.producers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.consumerNames = tensor.consumers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
        });

        this.outputs.forEach((tensor: TensorData) => {
            tensor.producerNames = tensor.producers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.consumerNames = tensor.consumers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
        });

        this.tensorList =
            [
                [
                    ...(this.inputs.map((input) => {
                        return { ...input, io: 'input' } as TensorData;
                    }) || []),
                ],
                [
                    ...(this.outputs.map((output) => {
                        return { ...output, io: 'output' } as TensorData;
                    }) || []),
                ],
            ].flat() || [];

        this.historicalTensorListByAddress = this.createHitoricalTensorList();
        this.historicalTensorListByAddress.forEach((tensor) => {
            tensor.producerNames = tensor.producers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.consumerNames = tensor.consumers.map((op) => {
                return this.operations.find((operation) => operation.id === op)?.name || '';
            });
        });
        this.historicalTensorListById = new Map(
            Array.from(this.historicalTensorListByAddress.values()).map((tensor) => [tensor.id, tensor]),
        );

        const deviceOpList: Node[] = [];
        if (this.device_operations !== null) {
            this.device_operations.forEach((node) => {
                if (node.node_type === NodeType.function_start) {
                    this.deviceOperations.push({
                        indentLevel: deviceOpList.length,
                        name: node.params.name,
                        cbList: [],
                        deallocateAll: false,
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
                            });
                        }
                    }
                }
                if (node.node_type === NodeType.circular_buffer_deallocate_all) {
                    const deviceOpNode = deviceOpList.at(-1);
                    if (deviceOpNode) {
                        const deviceOp = this.deviceOperations
                            .slice()
                            .reverse()
                            .find((op) => op.name === deviceOpNode.params.name);

                        if (deviceOp) {
                            deviceOp.deallocateAll = true;
                        }
                    }
                }
            });
        }
    }

    private getChartData(memory: Chunk[], overrides?: PlotDataOverrides): Partial<PlotData>[] {
        return memory.map((chunk) => {
            const { address, size } = chunk;
            const color = overrides?.color
                ? overrides?.color
                : getBufferColor(address + (overrides?.colorVariance || 0));
            const tensor = this.getTensorForAddress(address);
            return {
                x: [address + size / 2],
                y: [1],
                type: 'bar',
                width: [size],
                marker: {
                    color,
                    line: {
                        width: 0,
                        opacity: 0,
                        simplify: false,
                    },
                },
                memoryData: {
                    address,
                    size,
                    tensor,
                },
                hoverinfo: 'none',
                hovertemplate:
                    overrides?.hovertemplate !== undefined
                        ? overrides?.hovertemplate
                        : `
<span style="color:${color};font-size:20px;">&#9632;</span>
${address} (${toHex(address)}) <br>Size: ${formatSize(size)}
${tensor ? `<br><br>Tensor ${tensor.id}` : ''}
<extra></extra>`,

                hoverlabel: {
                    align: 'right',
                    bgcolor: 'white',
                    padding: {
                        t: 10,
                        b: 10,
                        l: 10,
                        r: 10,
                    },

                    font: {
                        color: 'black',
                        weight: 'bold',
                        size: 14,
                    },
                },
            };
        });
    }

    get memorySizeL1(): number {
        // TODO: memorysize will need to be read from the appropriate device even though its likely going to be the same for the multichip scenario
        return this.l1_sizes?.[0] || 0;
    }

    getTensorForAddress(address: number): TensorData | HistoricalTensor | null {
        const tensorData = this.tensorList.find((tensor) => tensor.address === address) || null;
        if (!tensorData) {
            return this.historicalTensorListByAddress.get(address) || null;
        }
        return tensorData;
    }

    getTensorProducerConsumer(id: number | null) {
        if (id === null) {
            return { producers: [], consumers: [] };
        }

        let tensor: TensorData | HistoricalTensor | undefined = this.tensorList.find((t) => t.id === id);

        if (!tensor) {
            tensor = this.historicalTensorListById.get(id);
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

    memoryData(bufferType: BufferType = BufferType.L1): {
        chartData: Partial<PlotData>[];
        memory: Chunk[];
        fragmentation: FragmentationEntry[];
        condensed: Chunk;
        condensedChart: Partial<PlotData>[];
        cbChartData: Partial<PlotData>[];
        cbChartDataByOperation: Map<{ name: string; index: number }, Partial<PlotData>[]>
        cbMemory: Chunk[];
    } {
        const fragmentation: FragmentationEntry[] = [];
        const memory: Chunk[] =
            this.buffers
                ?.filter((buffer: BufferData) => buffer.buffer_type === bufferType)
                .map((buffer: BufferData) => {
                    return {
                        address: buffer.address,
                        size: buffer.max_size_per_bank,
                    };
                })
                .sort((a, b) => a.address - b.address) || [];

        const cbMemory = bufferType === BufferType.L1 ? this.deviceOperations.flatMap((op) => op.cbList) : [];

        const totalMemory = [
            { address: 0, size: 0 },
            ...cbMemory,
            ...memory,
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
                    fragmentation.push({
                        address: prevChunk.address + prevChunk.size,
                        size: chunk.address - (prevChunk.address + prevChunk.size),
                        empty: true,
                    });
                }
            }
        });

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

        const chartData = this.getChartData(memory);
        const cbColor = '#e2defc';
        const cbHoverTemplate = `
<span style="color:${cbColor};font-size:20px;">&#9632;</span>
${cbCondensed.address} (${toHex(cbCondensed.address)}) <br>Size: ${formatSize(cbCondensed.size)}
<br><br>CBs Summary
<extra></extra>`;

        const cbChartData = this.getChartData([cbCondensed], { color: cbColor, hovertemplate: cbHoverTemplate });
        const cbChartDataByOperation: Map<{ name: string; index: number }, Partial<PlotData>[]> = new Map();
        this.deviceOperations.forEach((op, index) => {
            if (op.cbList.length !== 0) {
                op.colorVariance = index;
                cbChartDataByOperation.set(
                    {
                        name: op.name,
                        index,
                    },
                    this.getChartData(op.cbList, { colorVariance: op.colorVariance }),
                );
            }
        });

        return {
            chartData,
            memory,
            fragmentation,
            condensed,
            condensedChart: this.getChartData([condensed]),
            cbChartData,
            cbChartDataByOperation,
            cbMemory,
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

    private createHitoricalTensorList() {
        const tensorsByBufferAddress: Map<number, HistoricalTensor> = new Map();

        const currentOperation = this.operations.find((op) => op.id === this.id);

        // eslint-disable-next-line no-restricted-syntax
        for (const buffer of this.buffers) {
            const bufferAddress = buffer.address;
            const bufferType = buffer.buffer_type;
            let opId: number | undefined;
            let tensor: Tensor | undefined;

            for (let i = this.operations.indexOf(currentOperation!); i >= 0; i--) {
                const op = this.operations[i];
                opId = op.id;

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
                const historicalTensor: HistoricalTensor = {
                    ...tensor,
                    parentOperationId: opId!,
                    historical: opId! !== this.id,
                    buffer_type: bufferType,
                };
                tensorsByBufferAddress.set(bufferAddress, historicalTensor);
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
}
