// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The device-operation memory legend's columns are definite widths in
// `_variables.scss`, and #1879 moved the `x N cores x N devices` multipliers from the
// size column into the tensor column. Asserted against the stylesheet because jsdom
// cannot measure geometry.
const VARIABLES = readFileSync(resolve(process.cwd(), 'src/scss/definitions/_variables.scss'), {
    encoding: 'utf8',
});

const pxVar = (name: string): number => {
    const match = VARIABLES.match(new RegExp(`\\$${name}:\\s*(\\d+)px`));
    expect(match, `$${name} not found in _variables.scss`).not.toBeNull();
    return Number(match?.[1]);
};

// `x 50 cores x 32 devices` measured 202px including its 8px gap on the report the
// issue cites, so the 180px this column used to be truncated it mid-word.
const WIDEST_OBSERVED_MULTIPLIER_PX = 202;

// What the size and tensor columns summed to before the multipliers moved. It is not
// a magic number: the pair's width is what places the numeric gutter to its right,
// which #1897 records as correct today. Trade width between the two rather than
// growing the pair, and update this with a note if the gutter is deliberately moved.
const COLUMN_PAIR_BUDGET_PX = 480;

describe('device operation legend column budget', () => {
    it('gives the tensor column room for the multipliers it now carries', () => {
        expect(pxVar('legend-tensor-column')).toBeGreaterThanOrEqual(WIDEST_OBSERVED_MULTIPLIER_PX);
    });

    it('keeps the size and tensor columns summing to their original budget', () => {
        expect(
            pxVar('legend-size-column') + pxVar('legend-tensor-column'),
            'these two columns place the numeric gutter beside them — trade width between them rather than growing the pair',
        ).toBe(COLUMN_PAIR_BUDGET_PX);
    });

    it('leaves the size column wider than a size plus its marker slot', () => {
        // Narrowed once the multipliers left it; must still clear the widest size text
        // with the aliased-CB marker reserved beside it.
        expect(pxVar('legend-size-column')).toBeGreaterThan(pxVar('legend-marker-slot') + 100);
    });
});
