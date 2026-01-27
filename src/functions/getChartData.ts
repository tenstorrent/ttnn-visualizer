// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { getBufferColor, getTensorColor } from './colorGenerator';
import { formatMemorySize, toHex } from './math';
import { toReadableLayout, toReadableShape, toReadableType } from './formatting';
import { BufferPage, Chunk, ColoredChunk, Tensor } from '../model/APIData';
import { PlotDataCustom } from '../definitions/PlotConfigurations';
import { TensorMemoryLayout } from './parseMemoryConfig';

export default function getChartData(
    memory: Chunk[],
    getTensorForAddress: (id: number) => Tensor | null,
    overrides?: { color?: string; colorVariance?: number; hovertemplate?: string },
    options?: { renderPattern?: boolean; lateDeallocation?: boolean; showHex?: boolean },
): Partial<PlotDataCustom>[] {
    return memory.map((chunk) => {
        const { address, size } = chunk;
        const tensor = getTensorForAddress(address);
        const tensorColor = getTensorColor(tensor?.id);
        let color;
        if (overrides?.color) {
            color = overrides?.color;
        } else if ('color' in chunk && typeof chunk.color === 'string' && chunk.color) {
            // check for ColoredChunk
            color = chunk.color;
        } else {
            color = tensorColor !== undefined ? tensorColor : getBufferColor(address + (overrides?.colorVariance || 0));
        }

        const tensorMemoryLayout = tensor?.memory_config?.memory_layout;

        let pattern = {};

        if (options?.renderPattern) {
            //  shape options "" | "/" | "\\" | "x" | "-" | "|" | "+" | ".";

            if (tensorMemoryLayout === TensorMemoryLayout.INTERLEAVED) {
                pattern = {
                    shape: '.',
                    fillmode: 'overlay',
                    size: 4,
                    fgcolor: 'rgba(0, 0, 0, 0.3)',
                };
            }
            if (tensorMemoryLayout === TensorMemoryLayout.BLOCK_SHARDED) {
                pattern = {
                    shape: '+',
                    fillmode: 'overlay',
                    size: 6,
                    fgcolor: 'rgba(0, 0, 0, 0.2)',
                };
            }
            if (tensorMemoryLayout === TensorMemoryLayout.HEIGHT_SHARDED) {
                pattern = {
                    shape: '|',
                    fillmode: 'overlay',
                    size: 6,
                    fgcolor: 'rgba(0, 0, 0, 0.2)',
                };
            }
            if (tensorMemoryLayout === TensorMemoryLayout.WIDTH_SHARDED) {
                pattern = {
                    shape: '-',
                    fillmode: 'overlay',
                    size: 6,
                    fgcolor: 'rgba(0, 0, 0, 0.2)',
                };
            }
        }

        if (options?.lateDeallocation && chunk.lateDeallocation) {
            pattern = {
                shape: '/',
                fillmode: 'overlay',
                size: 5,
                fgcolor: 'rgba(0, 0, 0, 0.6)',
            };
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
                pattern,
            },
            memoryData: {
                address,
                size,
                tensor,
            },
            hovertemplate:
                overrides?.hovertemplate !== undefined
                    ? overrides?.hovertemplate
                    : `<span style="color:${color};font-size:20px;">&#9632;</span> ${options?.showHex ? toHex(address) : address} (${formatMemorySize(size, 2)})` +
                      `${
                          tensor
                              ? `<br />${toReadableShape(tensor.shape)} ${toReadableType(tensor.dtype)} ${
                                    tensorMemoryLayout ? toReadableLayout(tensorMemoryLayout) : ''
                                }<br />Tensor ${tensor.id}${
                                    options?.lateDeallocation && chunk.lateDeallocation
                                        ? ` - Can deallocate earlier`
                                        : ''
                                }`
                              : ''
                      }<extra></extra>`,
            hoverlabel: {
                align: 'right',
                bgcolor: 'white',
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
