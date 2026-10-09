// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, CanceledError, HttpStatusCode } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getLocalFolderReportSource,
    getReportLoadFailureReason,
    recordReportLoadFailed,
    recordReportLoadFailure,
    recordReportLoaded,
} from '../src/functions/reportLoadEvents';
import { EventLogEvent, ReportKind, ReportLoadFailureReason, ReportSource } from '../src/definitions/EventLogEvent';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

const getServerConfigMock = vi.hoisted(() => vi.fn(() => ({ SERVER_MODE: false })));

vi.mock('../src/functions/getServerConfig', () => ({ default: getServerConfigMock }));

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
    getServerConfigMock.mockReturnValue({ SERVER_MODE: false });
});

describe('report-load event payloads', () => {
    it('records only the bounded kind and source for a successful load', () => {
        recordReportLoaded(ReportKind.PROFILER, ReportSource.REMOTE_SYNC);

        expect(recordEvent).toHaveBeenCalledWith({
            event: EventLogEvent.REPORT_LOADED,
            details: { kind: ReportKind.PROFILER, source: ReportSource.REMOTE_SYNC },
        });
    });

    it('records only the bounded kind and reason for a failed load', () => {
        const error = getAxiosError(HttpStatusCode.InternalServerError, { error: 'private response message' });
        recordReportLoadFailed(ReportKind.NPE, getReportLoadFailureReason(error));

        expect(recordEvent).toHaveBeenCalledWith({
            event: EventLogEvent.REPORT_LOAD_FAILED,
            details: { kind: ReportKind.NPE, reason_class: ReportLoadFailureReason.OTHER },
        });
        expect(JSON.stringify(recordEvent.mock.calls)).not.toContain('private response message');
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

    it('uses the bounded fallback for transport and unknown failures', () => {
        expect(getReportLoadFailureReason(new Error('private response message'))).toBe(ReportLoadFailureReason.OTHER);
        expect(getReportLoadFailureReason(getAxiosError(HttpStatusCode.InternalServerError))).toBe(
            ReportLoadFailureReason.OTHER,
        );
    });
});

describe('recordReportLoadFailure', () => {
    it('skips axios cancels', () => {
        recordReportLoadFailure(ReportKind.PROFILER, new CanceledError('aborted'));

        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('classifies an HTTP error without recording the response body', () => {
        recordReportLoadFailure(
            ReportKind.PROFILER,
            getAxiosError(HttpStatusCode.NotFound, { error: 'private response message' }),
        );

        expect(recordEvent).toHaveBeenCalledWith({
            event: EventLogEvent.REPORT_LOAD_FAILED,
            details: { kind: ReportKind.PROFILER, reason_class: ReportLoadFailureReason.MISSING_FILE },
        });
        expect(JSON.stringify(recordEvent.mock.calls)).not.toContain('private response message');
    });
});

describe('getLocalFolderReportSource', () => {
    it('records every local folder pick as local_tt_metal outside SERVER_MODE', () => {
        expect(getLocalFolderReportSource({ isDemo: true })).toBe(ReportSource.LOCAL_TT_METAL);
        expect(getLocalFolderReportSource({ isDemo: false })).toBe(ReportSource.LOCAL_TT_METAL);
        expect(getLocalFolderReportSource({})).toBe(ReportSource.LOCAL_TT_METAL);
    });

    it('records folders the listing marks as demos as demo under SERVER_MODE', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        expect(getLocalFolderReportSource({ isDemo: true })).toBe(ReportSource.DEMO);
    });

    it("records any other folder as upload under SERVER_MODE, since only the session's uploads are listed", () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        expect(getLocalFolderReportSource({ isDemo: false })).toBe(ReportSource.UPLOAD);
        expect(getLocalFolderReportSource({})).toBe(ReportSource.UPLOAD);
    });
});
