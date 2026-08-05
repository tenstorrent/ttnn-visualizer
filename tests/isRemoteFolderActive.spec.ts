// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import isRemoteFolderActive from '../src/functions/isRemoteFolderActive';
import { RemoteFolder } from '../src/definitions/RemoteConnection';
import { ReportFolder } from '../src/definitions/Reports';

const PERFORMANCE_PATH = '/tt-metal/generated/profiler/ttrun';
const TIMESTAMP = '2026_07_28_18_04_24';

/** As the SSH listing reports a single-host report: no rank, name is the folder. */
const remoteFolder = (remotePath: string): RemoteFolder => {
    const reportName = remotePath.split('/').filter(Boolean).at(-1) ?? '';

    return { reportName, remotePath, lastModified: 1, syncedName: reportName };
};

/** As the SSH listing reports one rank of a multihost launch. */
const rankFolder = (rank: number): RemoteFolder => ({
    reportName: TIMESTAMP,
    remotePath: `${PERFORMANCE_PATH}/rank${rank}/reports/${TIMESTAMP}`,
    lastModified: 1,
    syncedName: `${TIMESTAMP}_rank${rank}`,
    rank,
});

/** How `useRestoreInstance` rebuilds the active report from the instance record. */
const restoredReport = (performanceName: string): ReportFolder => ({
    path: performanceName,
    reportName: performanceName,
    syncedName: performanceName,
});

/** How `RemoteSyncConfigurator` sets the active report on selection. */
const selectedReport = (folder: RemoteFolder): ReportFolder => ({
    path: folder.remotePath,
    reportName: folder.reportName,
    syncedName: folder.syncedName,
});

describe('isRemoteFolderActive', () => {
    it('matches a freshly selected folder by remote path', () => {
        const folder = rankFolder(1);

        expect(isRemoteFolderActive(folder, selectedReport(folder))).toBe(true);
    });

    it('matches a restored report by its synced folder name', () => {
        // Regression: ranks share a report name, so the restored `_rank<N>` name
        // never matched and the dropdown came back with no selection.
        expect(isRemoteFolderActive(rankFolder(0), restoredReport(`${TIMESTAMP}_rank0`))).toBe(true);
    });

    it('does not match a different rank of the same run', () => {
        expect(isRemoteFolderActive(rankFolder(1), restoredReport(`${TIMESTAMP}_rank0`))).toBe(false);
        expect(isRemoteFolderActive(rankFolder(1), selectedReport(rankFolder(0)))).toBe(false);
    });

    it('picks the right rank out of a listing', () => {
        const folders = [rankFolder(0), rankFolder(1), rankFolder(2)];

        const matched = folders.find((folder) => isRemoteFolderActive(folder, restoredReport(`${TIMESTAMP}_rank2`)));

        expect(matched?.remotePath).toBe(rankFolder(2).remotePath);
    });

    it('still matches single-host reports selected and restored', () => {
        const folder = remoteFolder(`/tt-metal/generated/profiler/reports/${TIMESTAMP}`);

        expect(isRemoteFolderActive(folder, selectedReport(folder))).toBe(true);
        expect(isRemoteFolderActive(folder, restoredReport(TIMESTAMP))).toBe(true);
    });

    it('matches an offline listing of an already-synced rank', () => {
        // `list_local_synced_performance_folders` reports the local folder name as
        // the synced name, so it lines up with the restored report.
        const folder: RemoteFolder = {
            reportName: TIMESTAMP,
            remotePath: `${PERFORMANCE_PATH}/${TIMESTAMP}_rank0`,
            lastModified: 1,
            syncedName: `${TIMESTAMP}_rank0`,
            rank: 0,
        };

        expect(isRemoteFolderActive(folder, restoredReport(`${TIMESTAMP}_rank0`))).toBe(true);
    });

    it('matches a profiler folder, which is never rank-qualified', () => {
        const folder = remoteFolder('/tt-metal/generated/ttnn/reports/resnet50');

        expect(isRemoteFolderActive(folder, restoredReport('resnet50'))).toBe(true);
    });

    it('does not match an unrelated report', () => {
        expect(isRemoteFolderActive(rankFolder(0), restoredReport('2026_07_28_19_00_00_rank0'))).toBe(false);
    });

    it('falls back to the remote path for rows cached before the wire carried a name', () => {
        const cached: RemoteFolder = {
            reportName: TIMESTAMP,
            remotePath: `${PERFORMANCE_PATH}/rank0/reports/${TIMESTAMP}`,
            lastModified: 1,
        };

        expect(isRemoteFolderActive(cached, selectedReport(cached))).toBe(true);
        expect(isRemoteFolderActive(cached, restoredReport(`${TIMESTAMP}_rank0`))).toBe(false);
    });
});
