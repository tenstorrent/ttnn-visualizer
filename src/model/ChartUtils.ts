import { PlotData } from 'plotly.js';
import { getBufferColor } from '../functions/colorGenerator';
import { BufferData, Chunk, FragmentationEntry, OperationDetailsData, TensorData } from './APIData';
import { formatSize, toHex } from '../functions/math';

export const getMemoryData = (operationDetails: OperationDetailsData) => {
    const inputs = operationDetails?.input_tensors;
    const outputs = operationDetails?.output_tensors;

    const tensorList: TensorData[] =
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

    const getTensorForAddress = (address: number): TensorData | null => {
        return tensorList.find((tensor) => tensor.address === address) || null;
    };

    const fragmentation: FragmentationEntry[] = [];
    const memory: Chunk[] =
        operationDetails?.buffers
            .filter((buffer: BufferData) => buffer.buffer_type === 1)
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
        const color = getBufferColor(address, getTensorForAddress(chunk.address)?.tensor_id);
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
${address} (${toHex(address)}) <br>Size: ${formatSize(size)} <extra></extra>`,
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
};
