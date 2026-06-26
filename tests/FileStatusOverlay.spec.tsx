// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import FileStatusOverlay from '../src/components/FileStatusOverlay';
import { getFileStatusLabel } from '../src/functions/getFileStatusLabel';
import { FileProgress, FileStatus } from '../src/model/APIData';
import { fileTransferProgressAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

function renderOverlay(progress: FileProgress) {
    return render(
        <TestProviders initialAtomValues={[[fileTransferProgressAtom, progress]]}>
            <FileStatusOverlay />
        </TestProviders>,
    );
}

afterEach(cleanup);

describe('FileStatusOverlay status row', () => {
    // Regression for issue #1599: the overlay opens on STARTED (empty filename)
    // and previously showed no per-file row, so the first DOWNLOADING event
    // injected a new <p> and grew the modal height. The STARTED label now
    // renders standalone so height stays stable across STARTED -> DOWNLOADING.
    it('shows the standalone STARTED label before a filename arrives', () => {
        renderOverlay({
            currentFileName: '',
            numberOfFiles: 3,
            percentOfCurrent: 0,
            finishedFiles: 0,
            status: FileStatus.STARTED,
            bytesTransferred: 0,
            bytesTotal: 200,
            currentFileSize: 0,
        });

        expect(screen.getByText(getFileStatusLabel(FileStatus.STARTED))).toBeInTheDocument();
    });

    it('shows the filename row when DOWNLOADING reports a current file', () => {
        renderOverlay({
            currentFileName: 'db.sqlite',
            numberOfFiles: 3,
            percentOfCurrent: 0,
            finishedFiles: 0,
            status: FileStatus.DOWNLOADING,
            bytesTransferred: 0,
            bytesTotal: 200,
            currentFileSize: 183 * 1024 * 1024,
        });

        expect(screen.getByText('db.sqlite')).toBeInTheDocument();
        expect(screen.queryByText(getFileStatusLabel(FileStatus.STARTED))).not.toBeInTheDocument();
    });

    // Uploads stream as a single multipart request, so currentFileName stays
    // empty throughout. The STARTED-only guard keeps the per-file row hidden
    // for UPLOADING — no standalone "Uploading" line for the whole upload.
    it('does not render the per-file row for UPLOADING with no filename', () => {
        renderOverlay({
            currentFileName: '',
            numberOfFiles: 5,
            percentOfCurrent: 0,
            finishedFiles: 0,
            status: FileStatus.UPLOADING,
            bytesTransferred: 64_000,
            bytesTotal: 1_024_000,
        });

        expect(screen.queryByText(getFileStatusLabel(FileStatus.STARTED))).not.toBeInTheDocument();
        expect(screen.queryByText(getFileStatusLabel(FileStatus.UPLOADING))).not.toBeInTheDocument();
    });

    it('renders PROCESSING as an indeterminate stage without transfer summary text', () => {
        renderOverlay({
            currentFileName: 'model.mlir',
            numberOfFiles: 2,
            percentOfCurrent: 100,
            finishedFiles: 0,
            status: FileStatus.PROCESSING,
            bytesTransferred: 256_000,
            bytesTotal: 256_000,
            currentFileSize: 256_000,
        });

        expect(screen.getByText('Processing report')).toBeInTheDocument();
        expect(screen.getByText(getFileStatusLabel(FileStatus.PROCESSING))).toBeInTheDocument();
        expect(screen.getByLabelText('Processing report')).toBeInTheDocument();
        expect(screen.queryByText(/files\s*\(/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/complete/i)).not.toBeInTheDocument();
    });
});
