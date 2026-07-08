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
});
