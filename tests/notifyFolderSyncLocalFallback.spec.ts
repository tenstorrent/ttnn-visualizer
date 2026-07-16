// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastType } from '../src/functions/createToastNotification';
import notifyFolderSyncLocalFallback from '../src/functions/notifyFolderSyncLocalFallback';

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
            'Loaded local copy',
            'Could not sync from remote; using previously synced report. Unable to establish SSH connection',
            ToastType.WARNING,
        );
    });
});
