// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceFileButton from '../src/components/operation-details/SourceFileButton';
import { StackSourceOrigin, StackTraceLanguage } from '../src/definitions/StackTrace';
import { TestProviders } from './helpers/TestProviders';

const isSourceFileAvailable = vi.fn();
const readRemoteFile = vi.fn();

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        readRemoteFile,
        isSourceFileAvailable,
        persistentState: { selectedConnection: null },
    }),
}));

const renderButton = (props: Partial<ComponentProps<typeof SourceFileButton>> = {}) =>
    render(
        <SourceFileButton
            filePath='/models/x.py'
            sourceFileId={null}
            lineNumber={2}
            language={StackTraceLanguage.PYTHON}
            {...props}
        />,
        { wrapper: TestProviders },
    );

beforeEach(() => {
    vi.clearAllMocks();
    isSourceFileAvailable.mockResolvedValue({ available: true, source: StackSourceOrigin.Path });
    readRemoteFile.mockResolvedValue({ data: 'line1\nline2', error: null, resolvedPath: '/models/x.py' });
});

afterEach(cleanup);

describe('SourceFileButton', () => {
    it('always renders the button labelled "Source"', () => {
        renderButton();

        expect(screen.getByRole('button', { name: 'Source' })).toBeInTheDocument();
    });

    it('opens the source overlay with file contents when the source is available', async () => {
        renderButton();

        fireEvent.click(screen.getByRole('button', { name: 'Source' }));

        expect(await screen.findByText('/models/x.py')).toBeInTheDocument();
        expect(readRemoteFile).toHaveBeenCalledWith('/models/x.py', null);
    });

    it('does not open the overlay and disables the button when the source is unavailable', async () => {
        isSourceFileAvailable.mockResolvedValue({ available: false, source: null });
        renderButton();

        const button = screen.getByRole('button', { name: 'Source' });
        fireEvent.click(button);

        await waitFor(() => expect(button).toBeDisabled());
        expect(readRemoteFile).not.toHaveBeenCalled();
        expect(screen.queryByText('/models/x.py')).not.toBeInTheDocument();
    });

    it('is disabled when there is neither a file path nor a source file id', () => {
        renderButton({ filePath: '', sourceFileId: null });

        expect(screen.getByRole('button', { name: 'Source' })).toBeDisabled();
    });

    it('shows an explanatory tooltip when the button is disabled', async () => {
        renderButton({ filePath: '', sourceFileId: null });

        fireEvent.mouseEnter(screen.getByRole('button', { name: 'Source' }));

        expect(await screen.findByText('No file path found for this stack trace')).toBeInTheDocument();
    });
});
