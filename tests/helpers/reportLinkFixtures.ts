// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { screen } from '@testing-library/react';
import { ReportPairLinkStatus } from '../../src/definitions/ReportLinks';
import { ReportLink } from '../../src/model/ReportLinks';

export const REPORT_LINKS_PROBE_TEST_ID = 'report-links-probe';

/** Reads what `ReportLinksProbe` rendered, i.e. the current `reportLinksAtom` value. */
export const getProbedReportLinks = (): ReportLink[] =>
    JSON.parse(screen.getByTestId(REPORT_LINKS_PROBE_TEST_ID).textContent ?? '[]');

/** Active reports whose folder basenames are the ids `mem-run` / `perf-run`. */
export const PROFILER_REPORT = { path: '/data/local/profiler-reports/mem-run', reportName: 'mem-run' };
export const PERFORMANCE_REPORT = { path: '/data/local/performance-reports/perf-run', reportName: 'perf-run' };

/** Takes report ids, not paths: derive them with `getFolderReportId` when starting from a folder. */
export const createReportLink = (
    profilerId: string,
    performanceId: string,
    overrides: Partial<ReportLink> = {},
): ReportLink => ({
    profilerId,
    performanceId,
    status: ReportPairLinkStatus.LINKED,
    recordedAt: 1,
    ...overrides,
});
