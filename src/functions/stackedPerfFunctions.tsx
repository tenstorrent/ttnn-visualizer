import React from 'react';
import HighlightedText from '../components/HighlightedText';
import { formatPercentage, formatSize } from './math';
import { StackedTableHeader, TypedStackedPerfRow } from '../definitions/StackedPerfTable';

const PERCENTAGE_KEYS = ['percent', 'flops_min', 'flops_max', 'flops_mean', 'flops_std'];

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

    if (typeof value === 'number' && PERCENTAGE_KEYS.includes(key)) {
        formatted = formatPercentage(value, decimals ?? 0);
    }

    if (typeof value === 'number') {
        formatted = formatSize(Number(value.toFixed(decimals ?? 0)));
    } else {
        formatted = value.toString();
    }

    if (unit) {
        formatted += ` ${unit}`;
    }

    return getCellMarkup(formatted, highlight);
};

export const getCellMarkup = (text: string, highlight?: string | null) => {
    if (!text) {
        return '';
    }

    if (highlight) {
        return (
            <HighlightedText
                text={text}
                filter={highlight || ''}
            />
        );
    }

    return <span>{text}</span>;
};
