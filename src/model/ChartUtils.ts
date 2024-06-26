import { PlotData } from 'plotly.js';
import { getBufferColor } from '../functions/colorGenerator';
import { BufferData, Chunk, FragmentationEntry, OperationDetailsData } from './APIData';

export const getMemoryData = (operationDetails: OperationDetailsData, zoomedInView: boolean) => {
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
        return {
            x: [address + size / 2],
            y: [1],
            type: 'bar',
            width: [size],
            marker: {
                color: getBufferColor(address),
                line: {
                    width: 0,
                    opacity: 0,
                    simplify: false,
                },
            },
            text: zoomedInView ? `${address}:${size}` : '',
            hovertext: `${address}:${size}`,
            hoverinfo: 'text',
        };
    });
    return { chartData, memory, fragmentation };
};
