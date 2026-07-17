// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { CanceledError } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastType } from '../src/functions/createToastNotification';
import notifyFolderSyncError, {
    FOLDER_LIST_SYNC_ERROR_TOAST_TITLE,
    REMOTE_FOLDER_MOUNT_ERROR_TOAST_TITLE,
    notifyFolderListSyncError,
    notifyRemoteFolderMountError,
} from '../src/functions/notifyFolderSyncError';

const { createToastNotification } = vi.hoisted(() => ({
    createToastNotification: vi.fn(),
}));

vi.mock('../src/functions/createToastNotification', async () => {
    const actual = await vi.importActual<typeof import('../src/functions/createToastNotification')>(
        '../src/functions/createToastNotification',
    );
    return {
        ...actual,
        default: createToastNotification,
    };
});

afterEach(() => {
    createToastNotification.mockReset();
});

describe('notifyFolderSyncError', () => {
    it('skips the toast for axios cancel / abort errors', () => {
        notifyFolderSyncError(new CanceledError('aborted'));

        expect(createToastNotification).not.toHaveBeenCalled();
    });

    it('toasts a normal sync failure', () => {
        notifyFolderSyncError(new Error('connection refused'));

        expect(createToastNotification).toHaveBeenCalledWith(
            'Folder sync error',
            'connection refused',
            ToastType.ERROR,
        );
    });
});

describe('notifyFolderListSyncError', () => {
    it('toasts the list-level sync error detail', () => {
        notifyFolderListSyncError('SSH timed out');

        expect(createToastNotification).toHaveBeenCalledWith(
            FOLDER_LIST_SYNC_ERROR_TOAST_TITLE,
            'SSH timed out',
            ToastType.ERROR,
        );
    });
});

describe('notifyRemoteFolderMountError', () => {
    it('skips the toast for axios cancel / abort errors', () => {
        notifyRemoteFolderMountError(new CanceledError('aborted'));

        expect(createToastNotification).not.toHaveBeenCalled();
    });

    it('toasts a mount failure', () => {
        notifyRemoteFolderMountError(new Error('Report is not synced locally'));

        expect(createToastNotification).toHaveBeenCalledWith(
            REMOTE_FOLDER_MOUNT_ERROR_TOAST_TITLE,
            'Report is not synced locally',
            ToastType.ERROR,
        );
    });
});
