// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TestProviders } from './helpers/TestProviders';
import NPEProcessingStatus from '../src/components/NPEProcessingStatus';
import { TEST_IDS } from '../src/definitions/TestIds';
import { MIN_NPE_DATA_VERSION, getNpeDataErrorType } from '../src/definitions/NPEData';

// Scrub the markup after each test
afterEach(cleanup);

it('renders an initial message', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus
                isLoading={false}
                dataVersion={null}
                errorType={getNpeDataErrorType(null)}
            />
        </TestProviders>,
    );

    expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INITIAL).textContent).toBeDefined();
});

it('handles incorrect NPE data versions', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus
                isLoading={false}
                hasUploadedFile
                dataVersion={null}
                errorType={getNpeDataErrorType(null)}
            />
        </TestProviders>,
    );

    expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INVALID_VERSION).textContent).toBeDefined();
});

it('handles incomplete NPE data', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus
                isLoading={false}
                hasUploadedFile
                dataVersion='0.1.0'
                errorType={getNpeDataErrorType('0.1.0', undefined, false)}
            />
        </TestProviders>,
    );

    expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INVALID_DATA).textContent).toBeDefined();
});

it('handles invalid JSON data', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus
                isLoading={false}
                hasUploadedFile
                dataVersion={MIN_NPE_DATA_VERSION}
                errorType={getNpeDataErrorType(MIN_NPE_DATA_VERSION, 422)}
            />
        </TestProviders>,
    );

    expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INVALID_JSON).textContent).toBeDefined();
});

it('handles unknown errors', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus
                isLoading={false}
                hasUploadedFile
                dataVersion={MIN_NPE_DATA_VERSION}
                errorType={getNpeDataErrorType(MIN_NPE_DATA_VERSION, 500)}
            />
        </TestProviders>,
    );

    expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_UNHANDLED_ERROR).textContent).toBeDefined();
});
