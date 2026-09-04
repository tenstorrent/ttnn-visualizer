// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from 'axios';
import { Mock } from 'vitest';
import type * as ReportLoadEvents from '../../src/functions/reportLoadEvents';
import { ReportKind } from '../../src/definitions/EventLogEvent';

type ReportLoadEventsModule = typeof ReportLoadEvents;

/**
 * Keep the real classifiers while spying on record calls. `recordReportLoadFailure`
 * has to be re-wired here: the original closes over the unmocked `recordReportLoadFailed`.
 */
export async function reportLoadEventsSpiesMock(
    importOriginal: () => Promise<ReportLoadEventsModule>,
    recordReportLoaded: Mock,
    recordReportLoadFailed: Mock,
): Promise<ReportLoadEventsModule> {
    const actual = await importOriginal();

    return {
        ...actual,
        recordReportLoaded,
        recordReportLoadFailed,
        recordReportLoadFailure: (kind: ReportKind, error: unknown) => {
            if (axios.isCancel(error)) {
                return;
            }

            recordReportLoadFailed(kind, actual.getReportLoadFailureReason(error));
        },
    };
}
