// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios, { HttpStatusCode } from 'axios';
import { EventLogEvent, ReportKind, ReportLoadFailureReason, ReportSource } from '../definitions/EventLogEvent';
import recordEvent from './recordEvent';

export function recordReportLoaded(kind: ReportKind, source: ReportSource): void {
    recordEvent({ event: EventLogEvent.REPORT_LOADED, details: { kind, source } });
}

export function recordReportLoadFailed(kind: ReportKind, reason: ReportLoadFailureReason): void {
    recordEvent({ event: EventLogEvent.REPORT_LOAD_FAILED, details: { kind, reason_class: reason } });
}

/** Classify and record a failure, skipping axios cancels so abort is not a load failure. */
export function recordReportLoadFailure(kind: ReportKind, error: unknown): void {
    if (axios.isCancel(error)) {
        return;
    }

    recordReportLoadFailed(kind, getReportLoadFailureReason(error));
}

export function getReportLoadFailureReason(error: unknown): ReportLoadFailureReason {
    if (!axios.isAxiosError(error)) {
        return ReportLoadFailureReason.OTHER;
    }

    const status = error.status ?? error.response?.status;

    switch (status) {
        case HttpStatusCode.Unauthorized:
        case HttpStatusCode.Forbidden:
            return ReportLoadFailureReason.PERMISSION;
        case HttpStatusCode.NotFound:
            return ReportLoadFailureReason.MISSING_FILE;
        case HttpStatusCode.PayloadTooLarge:
            return ReportLoadFailureReason.TOO_LARGE;
        default:
            return ReportLoadFailureReason.OTHER;
    }
}
