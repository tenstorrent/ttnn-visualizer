// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { Classes } from '@blueprintjs/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PerfTableSkeleton from '../src/components/performance/PerfTableSkeleton';
import { TEST_IDS } from '../src/definitions/TestIds';

const HEADERS = ['ID', 'OP Code', 'Device Time'];

afterEach(cleanup);

describe('PerfTableSkeleton', () => {
    it('renders the provided headers as real text', () => {
        render(<PerfTableSkeleton headers={HEADERS} />);

        HEADERS.forEach((header) => {
            expect(screen.getByText(header)).toBeInTheDocument();
        });
    });

    it('renders the requested number of skeleton rows and one skeleton cell per header', () => {
        const rowCount = 5;
        render(
            <PerfTableSkeleton
                headers={HEADERS}
                rowCount={rowCount}
            />,
        );

        const body = screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON).querySelector('tbody')!;
        const rows = within(body).getAllByRole('row');
        expect(rows).toHaveLength(rowCount);

        rows.forEach((row) => {
            expect(row.querySelectorAll(`.${Classes.SKELETON}`)).toHaveLength(HEADERS.length);
        });
    });

    it('adds a leading column to the header and every body row when hasLeadingColumn is set', () => {
        render(
            <PerfTableSkeleton
                headers={HEADERS}
                rowCount={3}
                hasLeadingColumn
            />,
        );

        const table = screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON);
        // The leading column header is aria-hidden, so query the DOM directly rather than by role.
        const headerCells = table.querySelector('thead')!.querySelectorAll('th');
        expect(headerCells).toHaveLength(HEADERS.length + 1);

        const body = table.querySelector('tbody')!;
        within(body)
            .getAllByRole('row')
            .forEach((row) => {
                expect(row.querySelectorAll(`.${Classes.SKELETON}`)).toHaveLength(HEADERS.length + 1);
            });
    });

    it('exposes an accessible busy state for screen readers', () => {
        render(<PerfTableSkeleton headers={HEADERS} />);

        const skeleton = screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON);
        expect(skeleton).toHaveAttribute('aria-busy', 'true');
        expect(skeleton).toHaveAccessibleName('Loading performance data');
    });
});
