// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import getPlotLabel from '../src/functions/getPlotLabel';

describe('getPlotLabel', () => {
    it.each<[string, number, string | null, string[] | null, string | undefined]>([
        ['the active report for the first dataset', 0, 'Base', ['Other'], 'Base'],
        ['a comparison report for a later dataset', 1, 'Base', ['Other'], 'Other'],
        ['the active report for a dataset the comparison list has no name for', 2, 'Base', ['Other'], 'Base'],
        ['no name when the active report has none', 0, null, null, undefined],
    ])('gives %s', (_, dataIndex, defaultName, comparisonName, expected) => {
        expect(getPlotLabel(dataIndex, defaultName, comparisonName)).toBe(expected);
    });

    it('gives an empty name when no report name is passed at all', () => {
        expect(getPlotLabel(0)).toBe('');
    });
});
