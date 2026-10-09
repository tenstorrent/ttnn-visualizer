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

    it('says why it did not fit, as the operation page does', () => {
        renderSummary([
            listing({ failure: makeAllocationFailure({ freeBytes: 1000000, largestFreeBlockBytes: 300000 }) }),
        ]);

        expect(screen.getByText('Out of memory')).toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.ALLOCATION_FAILURE_DETAILS)).toHaveTextContent(
            'Fragmented. 977 KiB free per bank',
        );
    });

    it('names the failed device op once, in the run status', () => {
        renderSummary([listing()]);

        expect(screen.getAllByText(/Failed in Conv2d/)).toHaveLength(1);
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
            screen.getByText('Failed in Conv2d before reaching the device, so it has no row in this report.'),
        ).toBeInTheDocument();
        expect(
            screen.getByText('Failed; 2 earlier device ops ran, so it has 2 rows in this report.'),
        ).toBeInTheDocument();
    });

    it('does not claim a failure never reached the device when no device op was recorded', () => {
        renderSummary([listing({ failedDeviceOperations: [] })]);

        expect(
            screen.getByText(
                'The memory report recorded no device ops for it, so no row in this report is linked to it.',
            ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/before reaching the device/)).not.toBeInTheDocument();
    });

    it('uses the singular for one earlier device op', () => {
        renderSummary([listing({ linkedRowCount: 1 })]);

        expect(
            screen.getByText('Failed in Conv2d; 1 earlier device op ran, so it has 1 row in this report.'),
        ).toBeInTheDocument();
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
