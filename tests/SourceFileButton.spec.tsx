// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceFileButton from '../src/components/operation-details/SourceFileButton';
import { StackSourceOrigin, StackTraceLanguage } from '../src/definitions/StackTrace';
import { MOCK_FULL_GIT_SHA, MOCK_HTTP_GIT_URL, MOCK_SHORT_GIT_SHA, MOCK_SSH_GIT_URL } from './helpers/gitFixtures';
import { TestProviders } from './helpers/TestProviders';

const isSourceFileAvailable = vi.fn();
const readRemoteFile = vi.fn();
const mockUseReportMetadata = vi.fn();

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        readRemoteFile,
        isSourceFileAvailable,
        persistentState: { selectedConnection: null },
    }),
}));

vi.mock('../src/hooks/useAPI.tsx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/hooks/useAPI.tsx')>();
    return {
        ...actual,
        useReportMetadata: () => mockUseReportMetadata(),
    };
});

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

const openSourceOverlay = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(await screen.findByText('/models/x.py')).toBeInTheDocument();
};

beforeEach(() => {
    vi.clearAllMocks();
    mockUseReportMetadata.mockReturnValue({ data: undefined });
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

        await openSourceOverlay();

        expect(readRemoteFile).toHaveBeenCalledWith('/models/x.py', null);
    });

    it('shows a commit link in the overlay when HTTP git metadata is present', async () => {
        mockUseReportMetadata.mockReturnValue({
            data: { gitUrl: MOCK_HTTP_GIT_URL, gitSha: MOCK_FULL_GIT_SHA },
        });
        renderButton();

        await openSourceOverlay();

        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', `https://github.com/foo/bar/commit/${MOCK_FULL_GIT_SHA}`);
        expect(link).toHaveTextContent(MOCK_SHORT_GIT_SHA);
    });

    it('shows plain commit text in the overlay when git metadata uses an SSH remote', async () => {
        mockUseReportMetadata.mockReturnValue({
            data: { gitUrl: MOCK_SSH_GIT_URL, gitSha: MOCK_FULL_GIT_SHA },
        });
        renderButton();

        await openSourceOverlay();

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText('Commit:')).toBeInTheDocument();
        expect(screen.getByText(MOCK_SHORT_GIT_SHA)).toBeInTheDocument();
    });

    it('shows commit info beside the path in the overlay error path', async () => {
        mockUseReportMetadata.mockReturnValue({
            data: { gitUrl: MOCK_HTTP_GIT_URL, gitSha: MOCK_FULL_GIT_SHA },
        });
        readRemoteFile.mockResolvedValue({
            data: null,
            error: 'Could not read source file',
            resolvedPath: '/models/x.py',
        });
        renderButton();

        await openSourceOverlay();

        expect(screen.getByText('Could not read source file')).toBeInTheDocument();
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', `https://github.com/foo/bar/commit/${MOCK_FULL_GIT_SHA}`);
    });

    it('does not subscribe to report metadata until the overlay is opened', () => {
        renderButton();

        expect(mockUseReportMetadata).not.toHaveBeenCalled();
    });

    it('does not open the overlay and disables the button when the source is unavailable', async () => {
        isSourceFileAvailable.mockResolvedValue({ available: false, source: null });
        renderButton();

        const button = screen.getByRole('button', { name: 'Source' });
        fireEvent.click(button);

        await waitFor(() => expect(button).toBeDisabled());
        expect(readRemoteFile).not.toHaveBeenCalled();
        expect(screen.queryByText('/models/x.py')).not.toBeInTheDocument();
        expect(mockUseReportMetadata).not.toHaveBeenCalled();
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
