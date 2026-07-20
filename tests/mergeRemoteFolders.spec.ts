// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { RemoteFolder } from '../src/definitions/RemoteConnection';
import mergeRemoteFolders from '../src/functions/mergeRemoteFolders';

const baseFolder = (overrides: Partial<RemoteFolder> = {}): RemoteFolder => ({
    reportName: 'resnet50',
    remotePath: '/remote/reports/resnet50',
    lastModified: 200,
    ...overrides,
});

describe('mergeRemoteFolders', () => {
    it('clears a cached lastSynced when the update sets null', () => {
        const merged = mergeRemoteFolders([baseFolder({ lastSynced: 100 })], [baseFolder({ lastSynced: null })]);

        expect(merged).toHaveLength(1);
        expect(merged[0].lastSynced).toBeNull();
    });

    it('keeps a cached lastSynced when the update omits the key', () => {
        const updated = baseFolder();
        delete updated.lastSynced;

        const merged = mergeRemoteFolders([baseFolder({ lastSynced: 100 })], [updated]);

        expect(merged).toHaveLength(1);
        expect(merged[0].lastSynced).toBe(100);
    });

    it('prefers a numeric lastSynced from the update', () => {
        const merged = mergeRemoteFolders([baseFolder({ lastSynced: 100 })], [baseFolder({ lastSynced: 250 })]);

        expect(merged[0].lastSynced).toBe(250);
    });
});
