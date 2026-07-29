// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { getReportBaseName, getReportRank, getSyncedFolderName } from '../src/functions/reportRank';

const PERFORMANCE_PATH = '/tt-metal/generated/profiler/ttrun';
const TIMESTAMP = '2026_07_28_18_04_24';

describe('getSyncedFolderName', () => {
    it('qualifies multihost reports with their rank', () => {
        expect(getSyncedFolderName(`${PERFORMANCE_PATH}/rank0/reports/${TIMESTAMP}`)).toBe(`${TIMESTAMP}_rank0`);
    });

    it('leaves single-host reports untouched', () => {
        expect(getSyncedFolderName(`/tt-metal/generated/profiler/reports/${TIMESTAMP}`)).toBe(TIMESTAMP);
    });

    it('does not double up an already qualified name', () => {
        expect(getSyncedFolderName(`${PERFORMANCE_PATH}/${TIMESTAMP}_rank0`)).toBe(`${TIMESTAMP}_rank0`);
    });
});

describe('getReportRank', () => {
    it('reads the rank from a remote rank directory', () => {
        expect(getReportRank(`${PERFORMANCE_PATH}/rank11/reports/${TIMESTAMP}`)).toBe(11);
    });

    it('reads the rank from a synced folder suffix', () => {
        expect(getReportRank(`${PERFORMANCE_PATH}/${TIMESTAMP}_rank2`)).toBe(2);
        expect(getReportRank(`${TIMESTAMP}_rank2`)).toBe(2);
    });

    it('returns null for single-host reports', () => {
        expect(getReportRank(`/tt-metal/generated/profiler/reports/${TIMESTAMP}`)).toBeNull();
    });

    it('ignores directories that only look like a rank', () => {
        // The backend qualifies folder names from `^rank\d+$` alone, so anything
        // it would not qualify must not be labelled with a rank here either.
        expect(getReportRank(`/tt-metal/ranked_reports/${TIMESTAMP}`)).toBeNull();
        expect(getReportRank(`${PERFORMANCE_PATH}/rank0beta/reports/${TIMESTAMP}`)).toBeNull();
    });

    it('takes the last rank directory, matching the backend reversed scan', () => {
        expect(getReportRank(`/runs/rank1/ttrun/rank2/reports/${TIMESTAMP}`)).toBe(2);
        expect(getSyncedFolderName(`/runs/rank1/ttrun/rank2/reports/${TIMESTAMP}`)).toBe(`${TIMESTAMP}_rank2`);
    });
});

describe('getReportBaseName', () => {
    it('strips the rank qualifier from a synced folder name', () => {
        expect(getReportBaseName(`${TIMESTAMP}_rank0`)).toBe(TIMESTAMP);
    });

    it('returns the report name from a remote path unchanged', () => {
        expect(getReportBaseName(`${PERFORMANCE_PATH}/rank0/reports/${TIMESTAMP}`)).toBe(TIMESTAMP);
    });
});
