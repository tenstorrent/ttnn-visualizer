// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TestProviders } from './helpers/TestProviders';
import NPEProcessingStatus from '../src/components/NPEProcessingStatus';

// Scrub the markup after each test
afterEach(cleanup);

it('renders an initial message', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus dataVersion={null} />
        </TestProviders>,
    );

    expect(screen.getByTestId('npe-processing-initial').textContent).toBeDefined();
});

it('handles incorrect NPE data versions', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus
                hasUploadedFile
                dataVersion={null}
            />
        </TestProviders>,
    );

    expect(screen.getByTestId('npe-processing-invalid-version').textContent).toBeDefined();
});

it('handles incomplete NPE data', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus
                hasUploadedFile
                dataVersion='0.1.0'
                isInvalidData
            />
        </TestProviders>,
    );

    expect(screen.getByTestId('npe-processing-invalid-data').textContent).toBeDefined();
});

it('handles invalid JSON data', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus
                hasUploadedFile
                dataVersion='1.0.0'
                fetchErrorCode={422}
            />
        </TestProviders>,
    );

    expect(screen.getByTestId('npe-processing-invalid-json').textContent).toBeDefined();
});

it('handles unknown errors', () => {
    render(
        <TestProviders>
            <NPEProcessingStatus
                hasUploadedFile
                dataVersion='1.0.0'
                fetchErrorCode={500}
            />
        </TestProviders>,
    );

    expect(screen.getByTestId('npe-processing-unhandled-error').textContent).toBeDefined();
});
