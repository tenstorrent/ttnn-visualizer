// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { CanceledError } from 'axios';
import { describe, expect, it } from 'vitest';
import { RemoteFolder } from '../src/model/RemoteConnection';
import getRemoteSyncFailureAction from '../src/functions/getRemoteSyncFailureAction';
import { RemoteSyncFailureAction } from '../src/definitions/RemoteSync';

const NEVER_SYNCED: RemoteFolder = {
    reportName: 'never',
    remotePath: '/remote/never',
    lastModified: 1_700_000_200,
    lastSynced: null,
};

const PREVIOUSLY_SYNCED: RemoteFolder = {
    reportName: 'stale',
    remotePath: '/remote/stale',
    lastModified: 1_700_000_200,
    lastSynced: 1_700_000_100,
};

describe('getRemoteSyncFailureAction', () => {
    it('ignores intentional axios cancels', () => {
        expect(getRemoteSyncFailureAction(new CanceledError('aborted'), PREVIOUSLY_SYNCED)).toBe(
            RemoteSyncFailureAction.IGNORE_CANCEL,
        );
    });

    it('falls back to the local copy when a folder was selected', () => {
        expect(getRemoteSyncFailureAction(new Error('Unable to establish SSH connection'), PREVIOUSLY_SYNCED)).toBe(
            RemoteSyncFailureAction.FALLBACK_LOCAL,
        );
    });

    it('falls back even when lastSynced metadata is missing', () => {
        expect(getRemoteSyncFailureAction(new Error('Unable to establish SSH connection'), NEVER_SYNCED)).toBe(
            RemoteSyncFailureAction.FALLBACK_LOCAL,
        );
    });

    it('shows an error when no folder is available', () => {
        expect(getRemoteSyncFailureAction(new Error('connection refused'), null)).toBe(
            RemoteSyncFailureAction.SHOW_ERROR,
        );
    });
});
