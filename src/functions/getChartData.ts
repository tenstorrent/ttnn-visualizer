// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { getBufferColor, getTensorColor } from './colorGenerator';
import { formatMemorySize, getMemoryAddress } from './math';
import { toReadableShape, toReadableType } from './formatting';
import { Chunk, ColoredChunk, DecoratedBufferChunk, Tensor } from '../model/APIData';
import { PlotDataCustom } from '../definitions/PlotConfigurations';
import { TensorMemoryLayout } from './parseMemoryConfig';

// Half-opacity tint + solid border; fill keeps the bar readable when the stroke clips at plot edges. #1652
const OUTLINE_FILL_ALPHA = 0.5;
const OUTLINE_BORDER_WIDTH = 2;

const RGB_TUPLE_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;

const withAlpha = (color: string | undefined, alpha: number): string | undefined => {
    if (!color) {
        return color;
    }
    const match = color.match(RGB_TUPLE_RE);
    if (match) {
        return `rgba(${match[1]},${match[2]},${match[3]},${alpha})`;
    }
    if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
        const hex =
            color.length === 4 ? `${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color.slice(1);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
            return `rgba(${r},${g},${b},${alpha})`;
        }
    }
    return color;
};

export default function getChartData(
    memory: Chunk[],
    getTensorForAddress: (id: number) => Tensor | null,
    overrides?: { color?: string; colorVariance?: number; hovertemplate?: string; outline?: boolean },
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

        const outline = overrides?.outline === true;
        const borderColor = outline ? color : undefined;
        const fillColor = outline ? withAlpha(color, OUTLINE_FILL_ALPHA) : color;
        const marker = outline
            ? {
                  color: fillColor,
                  line: {
                      width: OUTLINE_BORDER_WIDTH,
                      color: borderColor,
                      simplify: false,
                  },
                  pattern,
              }
            : {
                  color: fillColor,
                  line: {
                      width: 0,
                      opacity: 0,
                      simplify: false,
                  },
                  pattern,
              };

        return {
            x: [address + size / 2],
            y: [1],
            type: 'bar',
            width: [size],
            marker,
            memoryData: {
                address,
                size,
                tensor,
                colorVariance,
            },
            hovertemplate:
                overrides?.hovertemplate !== undefined
                    ? overrides?.hovertemplate
                    : createHoverTemplate(address, size, chunk, tensor, tensorMemoryLayout, fillColor, {
                          ...options,
                          aliased: outline,
                      }),
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
    options?: { lateDeallocation?: boolean; showHex?: boolean; aliased?: boolean },
): string => {
    const square = `<span style="color:${color};font-size:22px">&#9632;</span>`;
    const formattedAddress = getMemoryAddress(address, options?.showHex || false);
    const formattedSize = formatMemorySize(size);
    const canDeallocateText =
        options?.lateDeallocation && chunk.lateDeallocation ? ' - <u>Opportunity to deallocate earlier</u>' : '';
    const tensorDetails = tensor
        ? `${toReadableShape(tensor.shape)} ${toReadableType(tensor.dtype)}<br />${tensorMemoryLayout || ''}<br />Tensor ${tensor.id}${canDeallocateText}`
        : '';
    // Plotly hover doesn't decode named HTML entities — use ASCII dash. #1652
    let aliasedHeader = '';
    if (options?.aliased) {
        aliasedHeader = tensor
            ? `<b>Globally allocated CB</b> - aliased to Tensor ${tensor.id} below<br />`
            : `<b>Globally allocated CB</b><br />`;
    }

    return `${aliasedHeader}${square} ${formattedAddress} (${formattedSize})<br />${tensorDetails}<extra></extra>`;
};
