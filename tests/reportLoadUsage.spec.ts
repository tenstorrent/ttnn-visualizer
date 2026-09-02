// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, CanceledError, HttpStatusCode } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getNpeReportLoadFailureReason,
    getReportLoadFailureReason,
    recordReportLoadFailed,
    recordReportLoadFailure,
    recordReportLoaded,
} from '../src/functions/reportLoadUsage';
import { ReportKind, ReportLoadFailureReason, ReportSource, UsageEvent } from '../src/definitions/UsageEvent';
import { NPEValidationError } from '../src/definitions/NPEData';

const { recordUsage } = vi.hoisted(() => ({ recordUsage: vi.fn() }));

vi.mock('../src/functions/recordUsage', () => ({ default: recordUsage }));

const getAxiosError = (status: number, body: unknown = null): AxiosError => {
    const error = new AxiosError('private response message');
    error.status = status;
    error.response = {
        status,
        data: body,
        statusText: '',
        headers: {},
        config: error.config!,
    };
    return error;
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('report-load usage payloads', () => {
    it('records only the bounded kind and source for a successful load', () => {
        recordReportLoaded(ReportKind.PROFILER, ReportSource.REMOTE_SYNC);

        expect(recordUsage).toHaveBeenCalledWith({
            event: UsageEvent.REPORT_LOADED,
            details: { kind: ReportKind.PROFILER, source: ReportSource.REMOTE_SYNC },
        });
    });

    it('records only the bounded kind and reason for a failed load', () => {
        const error = getAxiosError(HttpStatusCode.InternalServerError, { error: 'private response message' });
        recordReportLoadFailed(ReportKind.NPE, getNpeReportLoadFailureReason(NPEValidationError.DEFAULT, error));

        expect(recordUsage).toHaveBeenCalledWith({
            event: UsageEvent.REPORT_LOAD_FAILED,
            details: { kind: ReportKind.NPE, reason_class: ReportLoadFailureReason.OTHER },
        });
        expect(JSON.stringify(recordUsage.mock.calls)).not.toContain('private response message');
    });
});

describe('getReportLoadFailureReason', () => {
    it.each([
        [HttpStatusCode.Unauthorized, ReportLoadFailureReason.PERMISSION],
        [HttpStatusCode.Forbidden, ReportLoadFailureReason.PERMISSION],
        [HttpStatusCode.NotFound, ReportLoadFailureReason.MISSING_FILE],
        [HttpStatusCode.PayloadTooLarge, ReportLoadFailureReason.TOO_LARGE],
    ])('maps HTTP %i to %s', (status, expected) => {
        expect(getReportLoadFailureReason(getAxiosError(status))).toBe(expected);
    });

    it('does not guess what an endpoint-specific 422 means', () => {
        expect(
            getReportLoadFailureReason(
                getAxiosError(HttpStatusCode.UnprocessableEntity, { error: 'private response message' }),
            ),
        ).toBe(ReportLoadFailureReason.OTHER);
    });

    it('accepts an explicit 422 classification from a caller that knows its contract', () => {
        expect(
            getReportLoadFailureReason(getAxiosError(HttpStatusCode.UnprocessableEntity), {
                unprocessableEntityReason: ReportLoadFailureReason.PARSE_ERROR,
            }),
        ).toBe(ReportLoadFailureReason.PARSE_ERROR);
    });

    it('uses the bounded fallback for transport and unknown failures', () => {
        expect(getReportLoadFailureReason(new Error('private response message'))).toBe(ReportLoadFailureReason.OTHER);
        expect(getReportLoadFailureReason(getAxiosError(HttpStatusCode.InternalServerError))).toBe(
            ReportLoadFailureReason.OTHER,
        );
    });
});

describe('getNpeReportLoadFailureReason', () => {
    it.each([
        [NPEValidationError.INVALID_NPE_VERSION, ReportLoadFailureReason.UNSUPPORTED_VERSION],
        [NPEValidationError.INVALID_JSON, ReportLoadFailureReason.PARSE_ERROR],
        [NPEValidationError.INVALID_NPE_DATA, ReportLoadFailureReason.PARSE_ERROR],
    ])('maps validation error %i to %s', (validationError, expected) => {
        expect(getNpeReportLoadFailureReason(validationError)).toBe(expected);
    });

    it('uses the HTTP failure when validation has no more specific reason', () => {
        expect(
            getNpeReportLoadFailureReason(
                NPEValidationError.DEFAULT,
                getAxiosError(HttpStatusCode.NotFound, { error: 'private response message' }),
            ),
        ).toBe(ReportLoadFailureReason.MISSING_FILE);
    });
});

describe('recordReportLoadFailure', () => {
    it('skips axios cancels', () => {
        recordReportLoadFailure(ReportKind.PROFILER, new CanceledError('aborted'));

        expect(recordUsage).not.toHaveBeenCalled();
    });

    it('classifies an HTTP error without recording the response body', () => {
        recordReportLoadFailure(
            ReportKind.PROFILER,
            getAxiosError(HttpStatusCode.NotFound, { error: 'private response message' }),
        );

        expect(recordUsage).toHaveBeenCalledWith({
            event: UsageEvent.REPORT_LOAD_FAILED,
            details: { kind: ReportKind.PROFILER, reason_class: ReportLoadFailureReason.MISSING_FILE },
        });
        expect(JSON.stringify(recordUsage.mock.calls)).not.toContain('private response message');
    });
});
