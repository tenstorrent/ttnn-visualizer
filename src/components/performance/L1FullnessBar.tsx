// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import classNames from 'classnames';
import { formatPercentage } from '../../functions/math';
import 'styles/components/L1FullnessBar.scss';

interface L1FullnessBarProps {
    fullnessPercent: number;
    largestFreePercent: number | null;
}

interface LegendEntry {
    swatchClass: string;
    label: string;
    value: number;
}

const MAX_PERCENT = 100;
const MIN_VISIBLE_SEGMENT_PERCENT = 0.5;
const PERCENT_DECIMALS = 1;

const USED_SEGMENT_CLASS = 'bar-used';
const LARGEST_FREE_SEGMENT_CLASS = 'bar-largest-free';
const FRAGMENTED_FREE_SEGMENT_CLASS = 'bar-fragmented-free';

const USED_LABEL = 'Used';
const LARGEST_FREE_LABEL = 'Largest free';
const FRAGMENTED_FREE_LABEL = 'Fragmented free';

function L1FullnessBar({ fullnessPercent, largestFreePercent }: L1FullnessBarProps) {
    const used = clampPercent(fullnessPercent);
    const freeTotal = Math.max(MAX_PERCENT - used, 0);
    const largestFree = largestFreePercent != null ? Math.min(clampPercent(largestFreePercent), freeTotal) : 0;
    const fragmentedFree = Math.max(freeTotal - largestFree, 0);

    const ariaLabel =
        `L1 usage: ${formatPercentage(used, PERCENT_DECIMALS)} used, ` +
        `${formatPercentage(largestFree, PERCENT_DECIMALS)} largest contiguous free, ` +
        `${formatPercentage(fragmentedFree, PERCENT_DECIMALS)} fragmented free`;

    const legendEntries: LegendEntry[] = [
        { swatchClass: USED_SEGMENT_CLASS, label: USED_LABEL, value: used },
        { swatchClass: LARGEST_FREE_SEGMENT_CLASS, label: LARGEST_FREE_LABEL, value: largestFree },
        { swatchClass: FRAGMENTED_FREE_SEGMENT_CLASS, label: FRAGMENTED_FREE_LABEL, value: fragmentedFree },
    ];

    return (
        <div className='l1-fullness-bar'>
            <div
                className='bar-track'
                role='img'
                aria-label={ariaLabel}
            >
                {used >= MIN_VISIBLE_SEGMENT_PERCENT && (
                    <div
                        className={classNames('bar-segment', USED_SEGMENT_CLASS)}
                        style={{ width: `${used}%` }}
                    />
                )}
                {largestFree >= MIN_VISIBLE_SEGMENT_PERCENT && (
                    <div
                        className={classNames('bar-segment', LARGEST_FREE_SEGMENT_CLASS)}
                        style={{ width: `${largestFree}%` }}
                    />
                )}
                {fragmentedFree >= MIN_VISIBLE_SEGMENT_PERCENT && (
                    <div
                        className={classNames('bar-segment', FRAGMENTED_FREE_SEGMENT_CLASS)}
                        style={{ width: `${fragmentedFree}%` }}
                    />
                )}
            </div>

            <ul
                className='bar-legend'
                aria-hidden='true'
            >
                {legendEntries.map(({ swatchClass, label, value }) => (
                    <li
                        key={swatchClass}
                        className='bar-legend-item'
                    >
                        <span className={classNames('bar-legend-swatch', swatchClass)} />
                        <span>{label}</span>
                        <span className='bar-legend-value'>{formatPercentage(value, PERCENT_DECIMALS)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function clampPercent(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }

    return Math.min(value, MAX_PERCENT);
}

export default L1FullnessBar;
