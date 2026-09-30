// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PerfTableFrame from '../src/components/performance/PerfTableFrame';

const BODY = (
    <tbody>
        <tr>
            <td>cell</td>
        </tr>
    </tbody>
);

afterEach(() => {
    cleanup();
});

describe('PerfTableFrame', () => {
    it('keeps its own table classes when a caller adds one', () => {
        render(<PerfTableFrame className='extra'>{BODY}</PerfTableFrame>);

        expect(screen.getByRole('table')).toHaveClass('perf-table', 'monospace', 'extra');
    });

    it('returns to the first row when the reset key changes, and only then', () => {
        const firstRows = [1, 2];
        const { rerender } = render(<PerfTableFrame scrollResetKey={firstRows}>{BODY}</PerfTableFrame>);
        const region = screen.getByRole('region', { name: 'Performance table' });

        region.scrollTop = 500;
        rerender(<PerfTableFrame scrollResetKey={firstRows}>{BODY}</PerfTableFrame>);
        expect(region.scrollTop).toBe(500);

        rerender(<PerfTableFrame scrollResetKey={[2, 1]}>{BODY}</PerfTableFrame>);
        expect(region.scrollTop).toBe(0);
    });
});
