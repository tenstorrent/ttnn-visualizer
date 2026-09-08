// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchReportMetadata } from '../src/hooks/useAPI';
import axiosInstance from '../src/libs/axiosInstance';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
}));

describe('fetchReportMetadata', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('maps git_url and git_sha to camelCase fields', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue({
            data: {
                schema_version: '2.0.0',
                capture_timestamp_ns: '1773424287168605099',
                total_duration_ns: '22119664963',
                git_url: 'https://github.com/foo/bar.git',
                git_sha: 'abcdef0123456789',
            },
        });

        const result = await fetchReportMetadata();

        expect(result.gitUrl).toBe('https://github.com/foo/bar.git');
        expect(result.gitSha).toBe('abcdef0123456789');
    });

    it('returns null for missing git fields', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue({
            data: {
                schema_version: '2.0.0',
                capture_timestamp_ns: '1773424287168605099',
                total_duration_ns: '22119664963',
            },
        });

        const result = await fetchReportMetadata();

        expect(result.gitUrl).toBeNull();
        expect(result.gitSha).toBeNull();
    });

    // world_size drives the footer's "rank 0 of N" scoping notice, so a
    // multi-host report must not be mistaken for a complete single-host run. #1842
    it('parses world_size from the multi-host metadata table', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue({
            data: {
                schema_version: '3.1',
                capture_timestamp_ns: '1782343284332053328',
                total_duration_ns: '4657719476',
                rank: '1',
                world_size: '2',
            },
        });

        const result = await fetchReportMetadata();

        expect(result.worldSize).toBe(2);
    });

    it.each([
        ['absent', undefined],
        ['unparseable', 'not-a-number'],
        ['below one', '0'],
    ])('falls back to a single rank when world_size is %s', async (_label, worldSize) => {
        vi.mocked(axiosInstance.get).mockResolvedValue({
            data: {
                schema_version: '2.0.0',
                capture_timestamp_ns: '1773424287168605099',
                total_duration_ns: '22119664963',
                world_size: worldSize,
            },
        });

        const result = await fetchReportMetadata();

        expect(result.worldSize).toBe(1);
    });
});
