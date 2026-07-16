// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastType } from '../src/functions/createToastNotification';
import notifyFolderSyncLocalFallback, {
    FOLDER_SYNC_LOCAL_FALLBACK_TOAST_DETAIL_PREFIX,
    FOLDER_SYNC_LOCAL_FALLBACK_TOAST_TITLE,
} from '../src/functions/notifyFolderSyncLocalFallback';

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

describe('notifyFolderSyncLocalFallback', () => {
    it('warns that a previously synced local copy will be used', () => {
        notifyFolderSyncLocalFallback(new Error('Unable to establish SSH connection'));

        expect(createToastNotification).toHaveBeenCalledWith(
            FOLDER_SYNC_LOCAL_FALLBACK_TOAST_TITLE,
            `${FOLDER_SYNC_LOCAL_FALLBACK_TOAST_DETAIL_PREFIX} Unable to establish SSH connection`,
            ToastType.WARNING,
        );
    });
});
