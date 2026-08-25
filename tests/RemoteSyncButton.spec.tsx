// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteSyncButton from '../src/components/report-selection/RemoteSyncButton';
import { FileTransferSource } from '../src/definitions/FileTransferSource';
import { RemoteFolder } from '../src/model/RemoteConnection';
import { TEST_IDS } from '../src/definitions/TestIds';
import {
    clearAllFileTransferProgress,
    fileTransferRegistryAtom,
    getInactiveFileTransferProgress,
} from '../src/store/app';
import { FileStatus } from '../src/model/APIData';
import { TestProviders } from './helpers/TestProviders';

vi.mock('@blueprintjs/core', async () => {
    const original = await vi.importActual<typeof import('@blueprintjs/core')>('@blueprintjs/core');
    return {
        ...original,
        Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
            <div
                data-testid='remote-sync-tooltip'
                data-content={typeof content === 'string' ? content : ''}
            >
                {children}
            </div>
        ),
    };
});

const FOLDER: RemoteFolder = {
    reportName: 'test-report',
    remotePath: '/remote/test-report',
    lastModified: 1_700_000_000,
    lastSynced: 1_700_000_100,
};

function renderSyncButton(
    registry: Partial<Record<FileTransferSource, ReturnType<typeof getInactiveFileTransferProgress>>>,
    isSyncingReportFolder = true,
) {
    return render(
        <TestProviders initialAtomValues={[[fileTransferRegistryAtom, registry]]}>
            <RemoteSyncButton
                selectedReportFolder={FOLDER}
                isSyncingReportFolder={isSyncingReportFolder}
                isSelectedReportFolderOutdated={false}
                isDisabled={false}
                handleClick={vi.fn()}
            />
        </TestProviders>,
    );
}

beforeEach(() => {
    clearAllFileTransferProgress();
});

afterEach(() => {
    cleanup();
    clearAllFileTransferProgress();
});

describe('RemoteSyncButton tooltip', () => {
    it('shows generic sync copy when only another source is active in the registry', () => {
        renderSyncButton({
            [FileTransferSource.MLIR_UPLOAD]: {
                ...getInactiveFileTransferProgress(),
                numberOfFiles: 2,
                percentOfCurrent: 80,
                status: FileStatus.UPLOADING,
            },
        });

        const tooltip = screen.getByTestId('remote-sync-tooltip');
        expect(tooltip).toHaveAttribute('data-content', 'Syncing report folder...');
        expect(screen.getByTestId(TEST_IDS.REMOTE_SYNC_BUTTON)).toBeInTheDocument();
    });

    it('shows per-file remote sync progress from the REMOTE_SYNC slot', () => {
        renderSyncButton({
            [FileTransferSource.REMOTE_SYNC]: {
                ...getInactiveFileTransferProgress(),
                numberOfFiles: 3,
                finishedFiles: 1,
                status: FileStatus.DOWNLOADING,
            },
            [FileTransferSource.MLIR_UPLOAD]: {
                ...getInactiveFileTransferProgress(),
                numberOfFiles: 2,
                percentOfCurrent: 100,
                status: FileStatus.PROCESSING,
            },
        });

        const tooltip = screen.getByTestId('remote-sync-tooltip');
        expect(tooltip).toHaveAttribute('data-content', 'Syncing… 1/3');
    });
});
