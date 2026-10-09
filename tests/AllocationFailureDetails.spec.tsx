// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import AllocationFailureDetails from '../src/components/AllocationFailureDetails';
import { TEST_IDS } from '../src/definitions/TestIds';
import { makeAllocationFailure } from './helpers/allocationFailure';

afterEach(cleanup);

describe('AllocationFailureDetails', () => {
    it('gives the kind, the figures and why it did not fit', () => {
        render(
            <AllocationFailureDetails
                failure={makeAllocationFailure({ freeBytes: 1000000, largestFreeBlockBytes: 300000 })}
                failedDeviceOperations={['Conv2dDeviceOperation']}
            />,
        );

        const details = screen.getByTestId(TEST_IDS.ALLOCATION_FAILURE_DETAILS);

        expect(details).toHaveTextContent('Out of memory');
        expect(details).toHaveTextContent('Requested 3.13 MiB L1 across 4 banks');
        expect(details).toHaveTextContent('Fragmented. 977 KiB free per bank');
        expect(details).toHaveTextContent('Failed in Conv2dDeviceOperation');
    });

    it('shows a status in place of the failed device ops when given one', () => {
        render(
            <AllocationFailureDetails
                failure={makeAllocationFailure()}
                failedDeviceOperations={['Conv2dDeviceOperation']}
                status={<p>Ran 2 earlier device ops</p>}
            />,
        );

        const details = screen.getByTestId(TEST_IDS.ALLOCATION_FAILURE_DETAILS);

        expect(details).toHaveTextContent('Ran 2 earlier device ops');
        expect(details).not.toHaveTextContent('Failed in');
    });

    it('leaves out what the report does not record', () => {
        render(
            <AllocationFailureDetails
                failure={makeAllocationFailure()}
                failedDeviceOperations={[]}
            />,
        );

        const details = screen.getByTestId(TEST_IDS.ALLOCATION_FAILURE_DETAILS);

        expect(details).not.toHaveTextContent('Failed in');
        expect(details.querySelector('.allocation-failure-diagnosis')).toBeNull();
    });
});
