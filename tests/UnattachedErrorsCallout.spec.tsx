// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UnattachedErrorsCallout from '../src/components/UnattachedErrorsCallout';
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

        expect(screen.getByText('1 error recorded that could not be matched to an operation')).toBeInTheDocument();
        expect(screen.getByText('ttnn.conv2d')).toBeInTheDocument();
        expect(screen.queryByText('ttnn.add')).not.toBeInTheDocument();
    });

    it('names an error without an operation name', () => {
        renderCallout([reportError({ operation_name: '' }), reportError()]);

        expect(screen.getByText('2 errors recorded that could not be matched to an operation')).toBeInTheDocument();
        expect(screen.getByText('Unknown operation')).toBeInTheDocument();
    });
});
