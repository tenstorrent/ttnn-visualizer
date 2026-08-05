// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { formatSyncedReportName, getRankedReportLabel } from '../src/functions/reportRank';

const TIMESTAMP = '2026_07_28_18_04_24';

describe('getRankedReportLabel', () => {
    it('names the rank the server reported', () => {
        expect(getRankedReportLabel(TIMESTAMP, 0)).toBe(`Rank 0: ${TIMESTAMP}`);
        expect(getRankedReportLabel(TIMESTAMP, 11)).toBe(`Rank 11: ${TIMESTAMP}`);
    });

    it('leaves single-host reports unqualified', () => {
        expect(getRankedReportLabel(TIMESTAMP, null)).toBe(TIMESTAMP);
        expect(getRankedReportLabel(TIMESTAMP, undefined)).toBe(TIMESTAMP);
    });
});

describe('formatSyncedReportName', () => {
    it('reads the rank back out of a synced folder name', () => {
        // What the app carries once a report is mounted, with no listing at hand.
        expect(formatSyncedReportName(`${TIMESTAMP}_rank0`)).toBe(`Rank 0: ${TIMESTAMP}`);
    });

    it('leaves an unqualified name alone', () => {
        expect(formatSyncedReportName(TIMESTAMP)).toBe(TIMESTAMP);
        expect(formatSyncedReportName('resnet50')).toBe('resnet50');
    });

    it('ignores a rank-looking fragment that is not the qualifier', () => {
        expect(formatSyncedReportName('rank0_of_8')).toBe('rank0_of_8');
        expect(formatSyncedReportName(`${TIMESTAMP}_rank0_retry`)).toBe(`${TIMESTAMP}_rank0_retry`);
    });

    it('reads the same label the picker shows for the same report', () => {
        // The two spellings of one report must not read differently to the user.
        expect(formatSyncedReportName(`${TIMESTAMP}_rank3`)).toBe(getRankedReportLabel(TIMESTAMP, 3));
    });
});
