// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UnattachedErrorsCallout from '../src/components/UnattachedErrorsCallout';
import { MAX_UNATTACHED_ERRORS_LISTED } from '../src/definitions/ReportErrors';
import { TEST_IDS } from '../src/definitions/TestIds';
import { ReportError } from '../src/model/APIData';

const mockUseReportErrors = vi.fn();

vi.mock('../src/hooks/useAPI', () => ({ useReportErrors: () => mockUseReportErrors() }));

const reportError = (overrides: Partial<ReportError> = {}): ReportError => ({
    operation_id: 0,
    operation_name: 'ttnn.conv2d',
    error_type: 'incomplete_operation',
    error_message: "Operation 'ttnn.conv2d' started but never completed (likely crashed)",
    stack_trace: '',
    timestamp: '',
    rank: 0,
    attached: false,
    ...overrides,
});

const renderCallout = (data: ReportError[] | undefined) => {
    mockUseReportErrors.mockReturnValue({ data });
    return render(<UnattachedErrorsCallout />);
};

afterEach(cleanup);

describe('UnattachedErrorsCallout', () => {
    it('renders nothing while the errors are loading', () => {
        renderCallout(undefined);

        expect(screen.queryByTestId(TEST_IDS.UNATTACHED_ERRORS)).not.toBeInTheDocument();
    });

    it('renders nothing when every error is shown on its operation', () => {
        renderCallout([reportError({ operation_id: 2, attached: true })]);

        expect(screen.queryByTestId(TEST_IDS.UNATTACHED_ERRORS)).not.toBeInTheDocument();
    });

    it('lists only the errors no operation shows', () => {
        renderCallout([
            reportError(),
            reportError({ operation_id: 2, operation_name: 'ttnn.add', error_type: 'RuntimeError', attached: true }),
        ]);

        expect(screen.getByText('1 error recorded that is not shown on any operation')).toBeInTheDocument();
        expect(screen.getByText('ttnn.conv2d')).toBeInTheDocument();
        expect(screen.queryByText('ttnn.add')).not.toBeInTheDocument();
    });

    it('names an error without an operation name', () => {
        renderCallout([reportError({ operation_name: '' }), reportError()]);

        expect(screen.getByText('2 errors recorded that are not shown on any operation')).toBeInTheDocument();
        expect(screen.getByText('Unknown operation')).toBeInTheDocument();
    });

    it('caps the list and counts the rest', () => {
        const total = MAX_UNATTACHED_ERRORS_LISTED + 3;
        renderCallout(Array.from({ length: total }, (_, index) => reportError({ operation_name: `ttnn.op${index}` })));

        expect(screen.getByText(`${total} errors recorded that are not shown on any operation`)).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(MAX_UNATTACHED_ERRORS_LISTED);
        expect(screen.getByText('And 3 more.')).toBeInTheDocument();
    });

    it('explains an allocation failure above its raw message', () => {
        renderCallout([
            reportError({
                error_type: 'RuntimeError',
                error_message:
                    'Out of Memory: Not enough space to allocate 3276800 B L1 buffer across 4 banks, where each bank needs to store 819200 B, but bank size is 1382720 B (allocated: 1000000 B, free: 382720 B, largest free block: 300000 B)',
            }),
        ]);

        const details = screen.getByTestId(TEST_IDS.ALLOCATION_FAILURE_DETAILS);

        expect(details).toHaveTextContent('Out of memory');
        expect(details).toHaveTextContent('Not enough free space. Short by 426 KiB per bank');
        // No captured graph comes with an unattached error to name the failed device op.
        expect(details).not.toHaveTextContent('Failed in');
        expect(screen.getByText('Error Message')).toBeInTheDocument();
    });

    it('explains nothing for an error that is not an allocation failure', () => {
        renderCallout([reportError()]);

        expect(screen.queryByTestId(TEST_IDS.ALLOCATION_FAILURE_DETAILS)).not.toBeInTheDocument();
    });

    it('omits the stack trace pane when the report recorded none', () => {
        renderCallout([reportError({ stack_trace: '' }), reportError({ stack_trace: 'frame 0' })]);

        expect(screen.getAllByText('Error Message')).toHaveLength(2);
        expect(screen.getAllByText('Error Stack Trace')).toHaveLength(1);
    });
});
