// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { screen } from '@testing-library/react';
import { PendingReportLoad, SettledReportKind } from '../../src/store/app';

export const PENDING_REPORT_LOADS_PROBE_TEST_ID = 'pending-report-loads-probe';

/** What `PendingReportLoadsProbe` last rendered of `pendingReportLoadsAtom`. */
export const getProbedPendingReportLoads = (): Partial<Record<SettledReportKind, PendingReportLoad>> =>
    JSON.parse(screen.getByTestId(PENDING_REPORT_LOADS_PROBE_TEST_ID).textContent ?? '{}');
