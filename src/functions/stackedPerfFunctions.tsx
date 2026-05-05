// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import HighlightedText from '../components/HighlightedText';
import { formatPercentage, formatSize } from './math';
import { StackedColumnKeys, StackedTableColumn, TypedStackedPerfRow } from '../definitions/StackedPerfTable';

export enum CellColour {
    White = 'white',
    Green = 'green',
    Red = 'red',
    Blue = 'blue',
    Magenta = 'magenta',
    Cyan = 'cyan',
    Yellow = 'yellow',
    Orange = 'orange',
    Grey = 'grey',
}

const OPERATION_COLOURS: { [key: string]: CellColour } = {
    '(torch)': CellColour.Red,
    Matmul: CellColour.Magenta,
    LayerNorm: CellColour.Cyan,
    AllGather: CellColour.Cyan,
    AllReduce: CellColour.Cyan,
    ScaledDotProductAttentionDecode: CellColour.Blue,
    ScaledDotProductAttentionGQADecode: CellColour.Blue,
    NlpCreateHeadsDeviceOperation: CellColour.Blue,
    NLPConcatHeadsDecodeDeviceOperation: CellColour.Blue,
    UpdateCache: CellColour.Blue,
    OptimizedConvNew: CellColour.Orange, // Deprecated - Conv2d is the new name for this operation
    Conv2d: CellColour.Orange,
};

const DEFAULT_COLOUR = CellColour.White;
const FALLBACK_COLOUR = CellColour.Grey;

export const formatStackedCell = (
    row: TypedStackedPerfRow,
    column: StackedTableColumn,
    highlight?: string | null,
): React.JSX.Element | string => {
    const { key, unit, decimals } = column;
    const value = row[key];
    let formatted: string | boolean | string[];

    if (value === null || value === '' || value === undefined) {
        return '';
    }

    if (typeof value === 'number') {
        formatted = formatSize(value, decimals);
    } else {
        formatted = value;
    }

    if (unit) {
        if (unit === '%') {
            formatted = formatPercentage(Number(value), decimals);
        } else {
            formatted += ` ${unit}`;
        }
    }

    return getCellMarkup(formatted, getCellColour(row, key), highlight);
};

export const getCellMarkup = (text: string, colour?: CellColour, highlight?: string | null) => {
    if (!text) {
        return '';
    }

    if (highlight) {
        return (
            <HighlightedText
                className={colour}
                text={text}
                filter={highlight || ''}
            />
        );
    }

    return <span className={colour}>{text}</span>;
};

export const getCellColour = (row: TypedStackedPerfRow, key: StackedColumnKeys): CellColour => {
    const value = row[key];

    if (key === StackedColumnKeys.OpCode) {
        const match = Object.keys(OPERATION_COLOURS).find((opCodeKey) =>
            row[StackedColumnKeys.OpCode].includes(opCodeKey),
        );

        return match ? OPERATION_COLOURS[match] : FALLBACK_COLOUR;
    }

    if (key === StackedColumnKeys.OpsCount || key === StackedColumnKeys.DeviceTimeSumUs) {
        return DEFAULT_COLOUR;
    }

    if (typeof value === 'number') {
        return value > 0 ? DEFAULT_COLOUR : FALLBACK_COLOUR;
    }

    if (key === StackedColumnKeys.OpCategory) {
        return DEFAULT_COLOUR;
    }

    // Shouldn't get to this point but need to return something
    return DEFAULT_COLOUR;
};
