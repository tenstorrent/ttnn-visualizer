// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getOverallFileTransferPercent } from '../src/functions/getOverallFileTransferPercent';
import { FileProgress, FileStatus } from '../src/model/APIData';

const baseProgress = (): FileProgress => ({
    currentFileName: '',
    numberOfFiles: 0,
    percentOfCurrent: 0,
    finishedFiles: 0,
    status: FileStatus.INACTIVE,
});

describe('getOverallFileTransferPercent', () => {
    it('returns job-level percent for remote sync DOWNLOADING', () => {
        const progress: FileProgress = {
            ...baseProgress(),
            numberOfFiles: 10,
            finishedFiles: 3,
            percentOfCurrent: 100,
            status: FileStatus.DOWNLOADING,
        };

        expect(getOverallFileTransferPercent(progress)).toBe(30);
    });

    it('returns job-level percent for remote sync STARTED', () => {
        const progress: FileProgress = {
            ...baseProgress(),
            numberOfFiles: 84,
            finishedFiles: 0,
            status: FileStatus.STARTED,
        };

        expect(getOverallFileTransferPercent(progress)).toBe(0);
    });

    it('returns per-file percent for uploads', () => {
        const progress: FileProgress = {
            ...baseProgress(),
            numberOfFiles: 5,
            finishedFiles: 0,
            percentOfCurrent: 42,
            status: FileStatus.UPLOADING,
        };

        expect(getOverallFileTransferPercent(progress)).toBe(42);
    });

    it('returns zero when no files and inactive', () => {
        expect(getOverallFileTransferPercent(baseProgress())).toBe(0);
    });

    it('rounds non-exact divisions to an integer percent', () => {
        // 1/3 = 33.333…; raw float would surface artifacts like
        // 33.33333333333333 and leak into ProgressBar / formatPercentage.
        const progress: FileProgress = {
            ...baseProgress(),
            numberOfFiles: 3,
            finishedFiles: 1,
            status: FileStatus.DOWNLOADING,
        };

        const result = getOverallFileTransferPercent(progress);

        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBe(33);
    });

    it('clamps to 100 if finishedFiles overshoots numberOfFiles', () => {
        const progress: FileProgress = {
            ...baseProgress(),
            numberOfFiles: 2,
            finishedFiles: 5,
            status: FileStatus.DOWNLOADING,
        };

        expect(getOverallFileTransferPercent(progress)).toBe(100);
    });
});
