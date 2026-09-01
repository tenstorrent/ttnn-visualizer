// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios, { HttpStatusCode } from 'axios';
import { ReportKind, ReportLoadFailureReason, ReportSource, UsageEvent } from '../definitions/UsageEvent';
import { NPEValidationError } from '../definitions/NPEData';
import recordUsage from './recordUsage';

interface ReportLoadFailureOptions {
    unprocessableEntityReason?: ReportLoadFailureReason;
}

export function recordReportLoaded(kind: ReportKind, source: ReportSource): void {
    recordUsage({ event: UsageEvent.REPORT_LOADED, details: { kind, source } });
}

export function recordReportLoadFailed(kind: ReportKind, reason: ReportLoadFailureReason): void {
    recordUsage({ event: UsageEvent.REPORT_LOAD_FAILED, details: { kind, reason_class: reason } });
}

export function getReportLoadFailureReason(
    error: unknown,
    options: ReportLoadFailureOptions = {},
): ReportLoadFailureReason {
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
        case HttpStatusCode.UnprocessableEntity:
            return options.unprocessableEntityReason ?? ReportLoadFailureReason.OTHER;
        default:
            return ReportLoadFailureReason.OTHER;
    }
}

export function getNpeReportLoadFailureReason(
    validationError: NPEValidationError,
    error: unknown = null,
): ReportLoadFailureReason {
    switch (validationError) {
        case NPEValidationError.INVALID_NPE_VERSION:
            return ReportLoadFailureReason.UNSUPPORTED_VERSION;
        case NPEValidationError.INVALID_JSON:
        case NPEValidationError.INVALID_NPE_DATA:
            return ReportLoadFailureReason.PARSE_ERROR;
        default:
            return getReportLoadFailureReason(error, {
                unprocessableEntityReason: ReportLoadFailureReason.PARSE_ERROR,
            });
    }
}
