// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { OperationDescription } from './Graph';
import { getBufferColor } from '../functions/colorGenerator';
import { formatSize, toHex } from '../functions/math';
import { BufferData, Chunk, FragmentationEntry, OperationDetailsData, TensorData } from './APIData';
import { BufferType } from './BufferType';
import { DRAM_MEMORY_SIZE } from '../definitions/DRAMMemorySize';

export class OperationDetails implements Partial<OperationDetailsData> {
    id: number;

    inputs: TensorData[];

    outputs: TensorData[];

    buffers: BufferData[];

    l1_sizes: number[];

    stack_trace: string;

    tensorList: TensorData[];

    constructor(data: OperationDetailsData) {
        this.id = data.id;
        this.inputs = data.inputs;
        this.outputs = data.outputs;
        this.buffers = data.buffers;
        this.l1_sizes = data.l1_sizes;
        this.stack_trace = data.stack_trace;

        const { inputs, outputs } = this;

        this.tensorList =
            [
                [
                    ...(inputs?.map((input) => {
                        return { ...input, io: 'input' } as TensorData;
                    }) || []),
                ],
                [
                    ...(outputs?.map((output) => {
                        return { ...output, io: 'output' } as TensorData;
                    }) || []),
                ],
            ].flat() || [];
    }

    private getChartData(memory: Chunk[]): Partial<PlotData>[] {
        return memory.map((chunk) => {
            const { address, size } = chunk;
            const color = getBufferColor(address);
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

                hoverinfo: 'none',
                hovertemplate: `
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

    getTensorForAddress(address: number): TensorData | null {
        return this.tensorList.find((tensor) => tensor.address === address) || null;
    }

    // TODO: this is unintuitive and poorly named method. consider refactor

    /** @description
     *
     * Mutates current object
     *
     * Updates the producer and consumer names for each tensor in the tensorList
     *
     * Unifies inputs and outputs into a single tensorList
     * */

    updateOperationNames(operations: OperationDescription[] | undefined): void {
        if (!operations) {
            return;
        }
        const { inputs, outputs } = this;

        inputs?.forEach((tensor) => {
            tensor.producerNames = tensor.producers.map((op) => {
                return operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.consumerNames = tensor.consumers.map((op) => {
                return operations.find((operation) => operation.id === op)?.name || '';
            });
        });

        outputs?.forEach((tensor) => {
            tensor.producerNames = tensor.producers.map((op) => {
                return operations.find((operation) => operation.id === op)?.name || '';
            });
            tensor.consumerNames = tensor.consumers.map((op) => {
                return operations.find((operation) => operation.id === op)?.name || '';
            });
        });

        this.tensorList =
            [
                [
                    ...(inputs?.map((input) => {
                        return { ...input, io: 'input' } as TensorData;
                    }) || []),
                ],
                [
                    ...(outputs?.map((output) => {
                        return { ...output, io: 'output' } as TensorData;
                    }) || []),
                ],
            ].flat() || [];
    }

    getTensorProducerConsumer(id: number | null) {
        if (id === null) {
            return { producers: [], consumers: [] };
        }

        const tensor = this.tensorList.filter((t) => t.id === id)[0];

        return {
            producers: tensor.producers.map((op, index) => ({
                id: op,
                name: tensor.producerNames[index],
            })),
            consumers: tensor.consumers.map((op, index) => ({
                id: op,
                name: tensor.consumerNames[index],
            })),
        };
    }

    memoryData(bufferType: BufferType = BufferType.L1): {
        chartData: Partial<PlotData>[];
        memory: Chunk[];
        fragmentation: FragmentationEntry[];
        condensed: Chunk;
        condensedChart: Partial<PlotData>[];
    } {
        const { buffers } = this;
        const fragmentation: FragmentationEntry[] = [];
        const memory: Chunk[] =
            buffers
                ?.filter((buffer: BufferData) => buffer.buffer_type === bufferType)
                .map((buffer: BufferData) => {
                    return {
                        address: buffer.address,
                        size: buffer.max_size_per_bank,
                    };
                })
                .sort((a, b) => a.address - b.address) || [];

        memory.forEach((chunk, index) => {
            if (index > 0) {
                const prevChunk = memory[index - 1];
                if (prevChunk.address + prevChunk.size !== chunk.address) {
                    fragmentation.push({
                        address: prevChunk.address + prevChunk.size,
                        size: chunk.address - (prevChunk.address + prevChunk.size),
                        empty: true,
                    });
                }
            }
        });

        const condensed: Chunk = {
            address: memory[0]?.address || 0,
            // eslint-disable-next-line no-unsafe-optional-chaining
            size: memory[memory.length - 1]?.address + memory[memory.length - 1]?.size || 0,
        };

        const chartData = this.getChartData(memory);

        return { chartData, memory, fragmentation, condensed, condensedChart: this.getChartData([condensed]) };
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
}
