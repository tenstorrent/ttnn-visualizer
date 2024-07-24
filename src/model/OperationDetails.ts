import { PlotData } from 'plotly.js';
import { Operation } from './Graph';
import { getBufferColor } from '../functions/colorGenerator';
import { formatSize, toHex } from '../functions/math';
import { BufferData, Chunk, FragmentationEntry, OperationDetailsData, TensorData } from './APIData';

export enum BufferType {
    L1 = 1,
    DRAM = 2,
}

export class OperationDetails implements Partial<OperationDetailsData> {
    id: number;

    inputs: TensorData[];

    outputs: TensorData[];

    buffers: BufferData[];

    l1_sizes: number[];

    stack_trace: string;

    tensorList: TensorData[];

    constructor(data: OperationDetailsData) {
        this.id = data.operation_id;
        this.inputs = data.input_tensors;
        this.outputs = data.output_tensors;
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

    get memorySize(): number {
        // TODO: memorysize will need to be read from the appropriate device even though its likely going to be the same for the multichip scenario
        return this.l1_sizes?.[0] || 0;
    }

    getTensorForAddress(address: number): TensorData | null {
        return this.tensorList.find((tensor) => tensor.address === address) || null;
    }

    updateOperationNames(operations: Operation[] | undefined): void {
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

        const tensor = this.tensorList.filter((t) => t.tensor_id === id)[0];

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

    /**
     * Get memory data for the operation L1 only
     * TODO: add DRAM buffer types and create separation
     */
    get memoryData(): { chartData: Partial<PlotData>[]; memory: Chunk[]; fragmentation: FragmentationEntry[] } {
        const { buffers } = this;
        const fragmentation: FragmentationEntry[] = [];
        const memory: Chunk[] =
            buffers
                ?.filter((buffer: BufferData) => buffer.buffer_type === BufferType.L1)
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
        const chartData: Partial<PlotData>[] = memory.map((chunk) => {
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
${tensor ? `<br><br>Tensor ${tensor.tensor_id}` : ''}
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

        return { chartData, memory, fragmentation };
    }
}
