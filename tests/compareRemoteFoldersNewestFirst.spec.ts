// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { RemoteFolder } from '../src/model/RemoteConnection';
import compareRemoteFoldersNewestFirst from '../src/functions/compareRemoteFoldersNewestFirst';

const folder = (remotePath: string, lastModified: number): RemoteFolder => ({
    reportName: remotePath.split('/').pop() ?? remotePath,
    remotePath,
    lastModified,
});

const sortedPaths = (folders: RemoteFolder[]) =>
    [...folders].sort(compareRemoteFoldersNewestFirst).map(({ remotePath }) => remotePath);

describe('compareRemoteFoldersNewestFirst', () => {
    it('puts the newest folder first', () => {
        expect(sortedPaths([folder('/r/old', 100), folder('/r/new', 300), folder('/r/mid', 200)])).toEqual([
            '/r/new',
            '/r/mid',
            '/r/old',
        ]);
    });

    it('orders folders sharing a time by remote path', () => {
        expect(sortedPaths([folder('/r/b', 100), folder('/r/c', 100), folder('/r/a', 100)])).toEqual([
            '/r/a',
            '/r/b',
            '/r/c',
        ]);
    });

    // Matches Python's string ordering, which the backend listing sorts by.
    it('compares paths by code point, not by locale or number', () => {
        expect(sortedPaths([folder('/r/rank2/x', 100), folder('/r/rank10/x', 100), folder('/r/Rank3/x', 100)])).toEqual(
            ['/r/Rank3/x', '/r/rank10/x', '/r/rank2/x'],
        );
    });

    it('moves a synced row whose time grew to the top', () => {
        const listed = [folder('/r/a', 300), folder('/r/b', 200), folder('/r/c', 100)];
        const afterSync = listed.map((f) => (f.remotePath === '/r/c' ? { ...f, lastModified: 400 } : f));

        expect(sortedPaths(afterSync)).toEqual(['/r/c', '/r/a', '/r/b']);
    });
});
