// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ColumnKeys } from '../src/definitions/PerfTable';
import { HIGH_DISPATCH_THRESHOLD_US } from '../src/definitions/Performance';
import { PerfTableRow, TypedPerfTableRow, signpostRowDefaults } from '../src/model/PerfTable';
import { enrichRowData } from '../src/functions/enrichPerfRowData';
import { calcHighDispatchOps, formatCell } from '../src/functions/perfFunctions';
import { makeRawPerfRow } from './helpers/perfRowFixtures';

const DISPATCH_TOOLTIP = `Op with > ${HIGH_DISPATCH_THRESHOLD_US} µs dispatch latency`;

const enrich = (overrides: Partial<PerfTableRow>[]) =>
    enrichRowData(
        overrides.map((override, index) => makeRawPerfRow({ id: String(index + 1), ...override })),
        [],
        null,
    );

// formatCell only branches on the column key, so the label is irrelevant here.
const renderDispatchCell = (row: TypedPerfTableRow) =>
    render(<>{formatCell(row, { name: '', key: ColumnKeys.HighDispatch })}</>).container;

// Blueprint loads the icon's SVG, and with it the <title>, asynchronously, hence findByTitle.
const expectFlagged = async (row: TypedPerfTableRow) => {
    renderDispatchCell(row);
    expect(await screen.findByTitle(DISPATCH_TOOLTIP)).toBeTruthy();
    cleanup();
};

const expectNotFlagged = (row: TypedPerfTableRow) => {
    expect(renderDispatchCell(row).childElementCount).toBe(0);
    cleanup();
};

afterEach(cleanup);

describe('High dispatch column and tracing banner', () => {
    // Regression: the column used to compare device time against the dispatch threshold.
    it('flag ops by op-to-op gap, not device time', async () => {
        const [longOpShortGap, shortOpLongGap] = enrich([
            { device_time: '500', op_to_op_gap: '1' },
            { device_time: '2', op_to_op_gap: '16.5' },
        ]);

        expectNotFlagged(longOpShortGap);
        await expectFlagged(shortOpLongGap);
    });

    it('agree on the threshold boundary and on rows with no gap', async () => {
        const rows = enrich([
            { device_time: '500', op_to_op_gap: '6.5' },
            { device_time: '2', op_to_op_gap: '16.5' },
            { device_time: '2', op_to_op_gap: '' },
        ]);

        const [atThreshold, overThreshold, noGap] = rows;

        expectNotFlagged(atThreshold);
        await expectFlagged(overThreshold);
        expectNotFlagged(noGap);

        // Only the 16.5 µs row counts: 16.5 - 6.5 = 10 µs, out of 504 + 16.5 + 6.5 = 527 µs overall.
        const { container } = render(<>{calcHighDispatchOps(rows)}</>);
        expect(container.textContent).toContain('could save 10 µs');
        expect(container.textContent).toContain('(1.9% of overall time)');
    });

    it('ignore signpost rows, which carry no high_dispatch flag', () => {
        const signpost = { ...enrich([{}])[0], ...signpostRowDefaults } as TypedPerfTableRow;
        delete signpost.high_dispatch;

        expectNotFlagged(signpost);
        expect(calcHighDispatchOps([signpost])).toBeNull();
    });
});
