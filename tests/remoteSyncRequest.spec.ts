// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    abortActiveRemoteSyncRequest,
    beginRemoteSyncRequest,
    endRemoteSyncRequest,
} from '../src/functions/remoteSyncRequest';

describe('remoteSyncRequest', () => {
    it('abortActiveRemoteSyncRequest aborts the active controller', () => {
        const controller = beginRemoteSyncRequest();

        abortActiveRemoteSyncRequest();

        expect(controller.signal.aborted).toBe(true);
    });

    it('endRemoteSyncRequest ignores abort after the request has ended', () => {
        const controller = beginRemoteSyncRequest();
        endRemoteSyncRequest(controller);

        abortActiveRemoteSyncRequest();

        expect(controller.signal.aborted).toBe(false);
    });
});
