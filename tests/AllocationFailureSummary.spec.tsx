// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import AllocationFailureSummary from '../src/components/performance/AllocationFailureSummary';
import { MAX_ALLOCATION_FAILURES_LISTED } from '../src/definitions/AllocationFailure';
import { TEST_IDS } from '../src/definitions/TestIds';
import { AllocationFailureListing } from '../src/model/AllocationFailure';
import { makeAllocationFailure } from './helpers/allocationFailure';

const listing = (overrides: Partial<AllocationFailureListing> = {}): AllocationFailureListing => ({
    failure: makeAllocationFailure(),
    failedDeviceOperations: ['Conv2d'],
    linkedRowCount: 0,
    ...overrides,
});

const renderSummary = (listings: AllocationFailureListing[]) =>
    render(
        <MemoryRouter>
            <AllocationFailureSummary listings={listings} />
        </MemoryRouter>,
    );

afterEach(cleanup);

describe('AllocationFailureSummary', () => {
    it('renders nothing without failures', () => {
        renderSummary([]);

        expect(screen.queryByTestId(TEST_IDS.PERF_ALLOCATION_FAILURE_SUMMARY)).not.toBeInTheDocument();
    });

    it('links each failure to its operation and gives its figures', () => {
        renderSummary([listing()]);

        expect(screen.getByText('1 allocation failure recorded in the linked memory report')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '240 ttnn.conv2d' })).toHaveAttribute('href', '/operations/240');
        expect(
            screen.getByText('Requested 3.13 MiB L1 across 4 banks (800 KiB per bank, bank size 1.32 MiB)'),
        ).toBeInTheDocument();
    });

    it('says whether any of the failed operation ran', () => {
        renderSummary([
            listing(),
            listing({
                failure: makeAllocationFailure({ operationId: 300 }),
                failedDeviceOperations: [],
                linkedRowCount: 2,
            }),
        ]);

        expect(
            screen.getByText('Failed in Conv2d before reaching the device, so it has no row in this table.'),
        ).toBeInTheDocument();
        expect(screen.getByText('Failed; 2 earlier device ops ran and are marked in the table.')).toBeInTheDocument();
    });

    it('caps the list and counts the rest', () => {
        const listings = Array.from({ length: MAX_ALLOCATION_FAILURES_LISTED + 2 }, (_, index) =>
            listing({ failure: makeAllocationFailure({ operationId: index }) }),
        );

        renderSummary(listings);

        expect(screen.getAllByRole('link')).toHaveLength(MAX_ALLOCATION_FAILURES_LISTED);
        expect(screen.getByText('And 2 more, listed with their errors in the operations view.')).toBeInTheDocument();
    });
});
