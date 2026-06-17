// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { getBufferColor, getTensorColor } from './colorGenerator';
import { formatMemorySize, getMemoryAddress } from './math';
import { toReadableShape, toReadableType } from './formatting';
import { Chunk, ColoredChunk, DecoratedBufferChunk, Tensor } from '../model/APIData';
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
        const colorVariance = overrides?.colorVariance || 0;
        let color;

        if (overrides?.color) {
            color = overrides?.color;
        } else if ('color' in chunk && typeof chunk.color === 'string' && chunk.color) {
            // check for ColoredChunk
            color = chunk.color;
        } else {
            color = tensorColor !== undefined ? tensorColor : getBufferColor(address + colorVariance);
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
                colorVariance,
            },
            hovertemplate:
                overrides?.hovertemplate !== undefined
                    ? overrides?.hovertemplate
                    : createHoverTemplate(address, size, chunk, tensor, tensorMemoryLayout, color, options),
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

/**
 * Project decorated buffer chunks onto the renderer-friendly
 * ``{address, size, color}`` shape. Aggregation already happened on the
 * backend (or in the legacy GROUP BY adapter), so this is a trivial map.
 *
 * Takes ``DecoratedBufferChunk`` rather than ``BufferChunk`` so the
 * colour-resolution step is forced to happen upstream (in the caller's
 * own ``useMemo``), never on cached API rows.
 */
export const bufferChunksToColoredChunks = (data: DecoratedBufferChunk[]): ColoredChunk[] =>
    data.map((chunk) => ({
        address: chunk.address,
        size: chunk.chunk_size,
        color: chunk.color,
    }));

const createHoverTemplate = (
    address: number,
    size: number,
    chunk: Chunk,
    tensor: Tensor | null,
    tensorMemoryLayout: TensorMemoryLayout | undefined,
    color?: string,
    options?: { lateDeallocation?: boolean; showHex?: boolean },
): string => {
    const square = `<span style="color:${color};font-size:22px">&#9632;</span>`;
    const formattedAddress = getMemoryAddress(address, options?.showHex || false);
    const formattedSize = formatMemorySize(size);
    const canDeallocateText =
        options?.lateDeallocation && chunk.lateDeallocation ? ' - <u>Opportunity to deallocate earlier</u>' : '';
    const tensorDetails = tensor
        ? `${toReadableShape(tensor.shape)} ${toReadableType(tensor.dtype)}<br />${tensorMemoryLayout || ''}<br />Tensor ${tensor.id}${canDeallocateText}`
        : '';

    return `${square} ${formattedAddress} (${formattedSize})<br />${tensorDetails}<extra></extra>`;
};
