// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios, { HttpStatusCode } from 'axios';
import { EventLogEvent, ReportKind, ReportLoadFailureReason, ReportSource } from '../definitions/EventLogEvent';
import { ReportFolder } from '../definitions/Reports';
import getErrorStatus from './getErrorStatus';
import getServerConfig from './getServerConfig';
import recordEvent from './recordEvent';

export function recordReportLoaded(kind: ReportKind, source: ReportSource): void {
    recordEvent({ event: EventLogEvent.REPORT_LOADED, details: { kind, source } });
}

/** Source of a report activated from the server's own report folders. */
export function getLocalFolderReportSource(folder: Pick<ReportFolder, 'isDemo'>): ReportSource {
    if (!getServerConfig()?.SERVER_MODE) {
        return ReportSource.LOCAL_TT_METAL;
    }

    // Hosted listings hold only demo folders and this session's own uploads.
    return folder.isDemo ? ReportSource.DEMO : ReportSource.UPLOAD;
}

export function recordReportLoadFailed(kind: ReportKind, reason: ReportLoadFailureReason): void {
    recordEvent({ event: EventLogEvent.REPORT_LOAD_FAILED, details: { kind, reason_class: reason } });
}

/** Classify and record a failure, skipping axios cancels so abort is not a load failure. */
export function recordReportLoadFailure(
    kind: ReportKind,
    error: unknown,
    classify: (error: unknown) => ReportLoadFailureReason = getReportLoadFailureReason,
): void {
    if (axios.isCancel(error)) {
        return;
    }

    recordReportLoadFailed(kind, classify(error));
}

export function getReportLoadFailureReason(error: unknown): ReportLoadFailureReason {
    switch (getErrorStatus(error)) {
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

/** As `getReportLoadFailureReason`, for a read whose 422 means the server could not parse the report. */
export function getParsedReportLoadFailureReason(error: unknown): ReportLoadFailureReason {
    return getErrorStatus(error) === HttpStatusCode.UnprocessableEntity
        ? ReportLoadFailureReason.PARSE_ERROR
        : getReportLoadFailureReason(error);
}
