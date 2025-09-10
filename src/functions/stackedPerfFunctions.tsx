// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import HighlightedText from '../components/HighlightedText';
import { formatPercentage, formatSize } from './math';
import { StackedTableHeader, StackedTableKeys, TypedStackedPerfRow } from '../definitions/StackedPerfTable';

type CellColour = 'white' | 'green' | 'red' | 'blue' | 'magenta' | 'cyan' | 'yellow' | 'orange' | 'grey';

const PERCENTAGE_KEYS = ['percent', 'flops_min', 'flops_max', 'flops_mean', 'flops_std'];
const OPERATION_COLOURS: { [key: string]: CellColour } = {
    '(torch)': 'red',
    Matmul: 'magenta',
    LayerNorm: 'cyan',
    AllGather: 'cyan',
    AllReduce: 'cyan',
    ScaledDotProductAttentionDecode: 'blue',
    ScaledDotProductAttentionGQADecode: 'blue',
    NlpCreateHeadsDeviceOperation: 'blue',
    NLPConcatHeadsDecodeDeviceOperation: 'blue',
    UpdateCache: 'blue',
    OptimizedConvNew: 'orange',
};

export const formatStackedCell = (
    row: TypedStackedPerfRow,
    header: StackedTableHeader,
    highlight?: string | null,
): React.JSX.Element | string => {
    const { key, unit, decimals } = header;
    let formatted: string | boolean | string[];
    const value = row[key];

    if (value == null || value === '') {
        return '';
    }

    if (typeof value === 'number') {
        formatted = PERCENTAGE_KEYS.includes(key)
            ? formatPercentage(value, decimals ?? 0)
            : formatSize(Number(value.toFixed(decimals ?? 0)));
    } else {
        formatted = value.toString();
    }

    if (unit) {
        formatted += ` ${unit}`;
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

export const getCellColour = (row: TypedStackedPerfRow, key: StackedTableKeys): CellColour => {
    if (PERCENTAGE_KEYS.includes(key)) {
        return typeof row[key] === 'number' && row[key]! > 0 ? 'white' : 'grey';
    }

    if (key === 'op_code') {
        const match = Object.keys(OPERATION_COLOURS).find((opCodeKey) => row.op_code.includes(opCodeKey));

        return match ? OPERATION_COLOURS[match] : 'grey';
    }

    if (key === 'ops_count' || key === 'device_time_sum_us') {
        return 'white';
    }

    // Shouldn't get to this point but need to return something
    return 'grey';
};
