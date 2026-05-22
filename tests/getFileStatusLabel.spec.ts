// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getFileStatusLabel, isActiveTransferStatus } from '../src/functions/getFileStatusLabel';
import { FileStatus } from '../src/model/APIData';

describe('getFileStatusLabel', () => {
    it.each<[FileStatus, string]>([
        [FileStatus.STARTED, 'Starting'],
        [FileStatus.DOWNLOADING, 'Downloading'],
        [FileStatus.UPLOADING, 'Uploading'],
        [FileStatus.FINISHED, 'Finished'],
        [FileStatus.FAILED, 'Failed'],
        [FileStatus.INACTIVE, 'Inactive'],
    ])('maps %s to %s', (status, expected) => {
        expect(getFileStatusLabel(status)).toBe(expected);
    });

    // Characterisation: if a new FileStatus is added the label map must be
    // updated or this test will fail.
    it('returns a non-empty label for every FileStatus value', () => {
        for (const status of Object.values(FileStatus)) {
            const label = getFileStatusLabel(status);
            expect(label, `missing label for ${status}`).toBeTruthy();
            expect(typeof label).toBe('string');
        }
    });
});

describe('isActiveTransferStatus', () => {
    it.each<FileStatus>([FileStatus.STARTED, FileStatus.DOWNLOADING, FileStatus.UPLOADING])(
        'treats %s as active',
        (status) => {
            expect(isActiveTransferStatus(status)).toBe(true);
        },
    );

    it.each<FileStatus>([FileStatus.FINISHED, FileStatus.FAILED, FileStatus.INACTIVE])(
        'treats %s as inactive',
        (status) => {
            expect(isActiveTransferStatus(status)).toBe(false);
        },
    );

    // Regression guard: FAILED was previously in the active set; keep it out
    // until a real backend emit path exists.
    it('does not treat FAILED as active', () => {
        expect(isActiveTransferStatus(FileStatus.FAILED)).toBe(false);
    });
});
