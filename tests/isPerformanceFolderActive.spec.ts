// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import isPerformanceFolderActive from '../src/functions/isPerformanceFolderActive';
import { RemoteFolder } from '../src/definitions/RemoteConnection';
import { ReportFolder } from '../src/definitions/Reports';

const PERFORMANCE_PATH = '/tt-metal/generated/profiler/ttrun';
const TIMESTAMP = '2026_07_28_18_04_24';

const remoteFolder = (remotePath: string): RemoteFolder => ({
    // Performance listings always name the folder after its remote directory.
    reportName: remotePath.split('/').filter(Boolean).at(-1) ?? '',
    remotePath,
    lastModified: 1,
});

const rankFolder = (rank: number) => remoteFolder(`${PERFORMANCE_PATH}/rank${rank}/reports/${TIMESTAMP}`);

/** How `useRestoreInstance` rebuilds the active report from the instance record. */
const restoredReport = (performanceName: string): ReportFolder => ({
    path: performanceName,
    reportName: performanceName,
});

/** How `RemoteSyncConfigurator` sets the active report on selection. */
const selectedReport = (folder: RemoteFolder): ReportFolder => ({
    path: folder.remotePath,
    reportName: folder.reportName,
});

describe('isPerformanceFolderActive', () => {
    it('matches a freshly selected folder by remote path', () => {
        const folder = rankFolder(1);

        expect(isPerformanceFolderActive(folder, selectedReport(folder))).toBe(true);
    });

    it('matches a restored report by its synced folder name', () => {
        // Regression: ranks share a report name, so the restored `_rank<N>` name
        // never matched and the dropdown came back with no selection.
        expect(isPerformanceFolderActive(rankFolder(0), restoredReport(`${TIMESTAMP}_rank0`))).toBe(true);
    });

    it('does not match a different rank of the same run', () => {
        expect(isPerformanceFolderActive(rankFolder(1), restoredReport(`${TIMESTAMP}_rank0`))).toBe(false);
        expect(isPerformanceFolderActive(rankFolder(1), selectedReport(rankFolder(0)))).toBe(false);
    });

    it('picks the right rank out of a listing', () => {
        const folders = [rankFolder(0), rankFolder(1), rankFolder(2)];

        const matched = folders.find((folder) =>
            isPerformanceFolderActive(folder, restoredReport(`${TIMESTAMP}_rank2`)),
        );

        expect(matched?.remotePath).toBe(rankFolder(2).remotePath);
    });

    it('still matches single-host reports selected and restored', () => {
        const folder = remoteFolder(`/tt-metal/generated/profiler/reports/${TIMESTAMP}`);

        expect(isPerformanceFolderActive(folder, selectedReport(folder))).toBe(true);
        expect(isPerformanceFolderActive(folder, restoredReport(TIMESTAMP))).toBe(true);
    });

    it('matches an offline listing built from the synced folder', () => {
        // `list_local_synced_performance_folders` synthesises the remote path from
        // the local folder name, which already carries the rank.
        const folder = remoteFolder(`${PERFORMANCE_PATH}/${TIMESTAMP}_rank0`);

        expect(isPerformanceFolderActive(folder, restoredReport(`${TIMESTAMP}_rank0`))).toBe(true);
    });

    it('does not match an unrelated report', () => {
        expect(isPerformanceFolderActive(rankFolder(0), restoredReport('2026_07_28_19_00_00_rank0'))).toBe(false);
    });
});
