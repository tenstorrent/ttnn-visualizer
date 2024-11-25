import { getBufferColor, getTensorColor } from './colorGenerator';
import { formatSize, toHex } from './math';
import { BufferPage, Chunk, ColoredChunk, TensorData } from '../model/APIData';
import { HistoricalTensor } from '../model/Graph';
import { PlotDataCustom } from '../definitions/PlotConfigurations';

export default function getChartData(
    memory: Chunk[],
    getTensorForAddress: (id: number) => TensorData | HistoricalTensor | null,
    overrides?: { color?: string; colorVariance?: number; hovertemplate?: string },
): Partial<PlotDataCustom>[] {
    return memory.map((chunk) => {
        const { address, size } = chunk;
        const tensor = getTensorForAddress(address);
        const tensorColor = getTensorColor(tensor?.id);
        let color;
        if (overrides?.color) {
            color = overrides?.color;
        } else {
            color = tensorColor !== undefined ? tensorColor : getBufferColor(address + (overrides?.colorVariance || 0));
            // check for ColoredChunk
            if ('color' in chunk && typeof chunk.color === 'string') {
                color = chunk.color;
            }
        }

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

export const pageDataToChunkArray = (data: BufferPage[]): ColoredChunk[] => {
    const mergedRangeByAddress: Map<number, { start: number; end: number; color: string | undefined }> = new Map();

    data.forEach((page: BufferPage) => {
        const { address } = page;
        const defaultRange = { start: Infinity, end: 0, color: page.color };
        const currentRange = mergedRangeByAddress.get(address) || defaultRange;
        currentRange.start = Math.min(currentRange.start, page.page_address);
        currentRange.end = Math.max(currentRange.end, page.page_address + page.page_size);
        mergedRangeByAddress.set(address, currentRange);
    });
    return Array.from(mergedRangeByAddress.entries()).map(([address, range]) => {
        return {
            address,
            size: range.end - range.start,
            color: range.color,
        };
    });
};
