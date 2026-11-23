// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The instance answers for whichever memory report is active when it handles a request,
 * which can already be a later pick. An answer naming another report must never reach
 * the cache under the report the query asked about (#2375).
 */

import { AxiosError, AxiosHeaders, AxiosResponse, HttpStatusCode, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axiosInstance from '../src/libs/axiosInstance';
import { ACTIVE_MEMORY_REPORT_HEADER } from '../src/definitions/ReportHeaders';
import {
    ReportChangedError,
    getMemoryReportData,
    getMemoryReportRetry,
    isReportChangedError,
} from '../src/functions/memoryReportRequest';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const ENDPOINT = '/api/operations';
const REPORT_ID = 'memory-run';
const DATA = [{ id: 1 }];

const answeredFor = (header: string | undefined, data: unknown = DATA) => ({
    data,
    headers: header === undefined ? {} : { [ACTIVE_MEMORY_REPORT_HEADER]: header },
});

const rejectedWith = (status: number, header: string) => {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    const response = {
        data: { error: 'Report metadata table does not exist' },
        status,
        statusText: '',
        headers: { [ACTIVE_MEMORY_REPORT_HEADER]: header },
        config,
    } as AxiosResponse;

    return new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, undefined, response);
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getMemoryReportData', () => {
    it('returns an answer for the report it asked about', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue(answeredFor(REPORT_ID));

        await expect(getMemoryReportData(ENDPOINT, REPORT_ID)).resolves.toBe(DATA);
    });

    it('passes the request config through', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue(answeredFor(REPORT_ID));
        const config = { params: { buffer_type: 1 } };

        await getMemoryReportData(ENDPOINT, REPORT_ID, config);

        expect(axiosInstance.get).toHaveBeenCalledWith(ENDPOINT, config);
    });

    it('throws away an answer for another report', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue(answeredFor('other-run'));

        const error = await getMemoryReportData(ENDPOINT, REPORT_ID).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ReportChangedError);
        expect(error).toBeInstanceOf(AxiosError);
        expect(isReportChangedError(error)).toBe(true);
        expect((error as AxiosError).status).toBeUndefined();
    });

    it('throws away an answer naming no report while one is expected', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue(answeredFor(''));

        await expect(getMemoryReportData(ENDPOINT, REPORT_ID)).rejects.toBeInstanceOf(ReportChangedError);
    });

    it('accepts an answer without the header, which only something in between can remove', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue(answeredFor(undefined));

        await expect(getMemoryReportData(ENDPOINT, REPORT_ID)).resolves.toBe(DATA);
    });

    it('matches a percent-encoded name against the folder basename', async () => {
        const name = 'mémoire run 报告';
        vi.mocked(axiosInstance.get).mockResolvedValue(answeredFor(encodeURIComponent(`/data/reports/${name}`)));

        await expect(getMemoryReportData(ENDPOINT, name)).resolves.toBe(DATA);
    });

    it('treats malformed percent-encoding as another report', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue(answeredFor('%E0%A4%A'));

        await expect(getMemoryReportData(ENDPOINT, REPORT_ID)).rejects.toBeInstanceOf(ReportChangedError);
    });

    it("throws away another report's error response", async () => {
        vi.mocked(axiosInstance.get).mockRejectedValue(rejectedWith(HttpStatusCode.UnprocessableEntity, 'other-run'));

        await expect(getMemoryReportData(ENDPOINT, REPORT_ID)).rejects.toBeInstanceOf(ReportChangedError);
    });

    it("rethrows this report's error response with its status", async () => {
        const rejection = rejectedWith(HttpStatusCode.UnprocessableEntity, REPORT_ID);
        vi.mocked(axiosInstance.get).mockRejectedValue(rejection);

        const error = await getMemoryReportData(ENDPOINT, REPORT_ID).catch((e: unknown) => e);

        expect(error).toBe(rejection);
        expect((error as AxiosError).response?.status).toBe(HttpStatusCode.UnprocessableEntity);
    });

    it('rethrows a non-axios error unchanged', async () => {
        const rejection = new Error('network down');
        vi.mocked(axiosInstance.get).mockRejectedValue(rejection);

        await expect(getMemoryReportData(ENDPOINT, REPORT_ID)).rejects.toBe(rejection);
    });
});

describe('getMemoryReportRetry', () => {
    const reportChanged = new ReportChangedError(REPORT_ID, 'other-run');
    const serverError = rejectedWith(HttpStatusCode.InternalServerError, REPORT_ID);

    it('retries an answer for another report once, at once', () => {
        const { retry, retryDelay } = getMemoryReportRetry();

        expect(retry(0, reportChanged)).toBe(true);
        expect(retryDelay(0, reportChanged)).toBe(0);
        expect(retry(1, reportChanged)).toBe(false);
    });

    it('does not retry other errors by default', () => {
        expect(getMemoryReportRetry().retry(0, serverError)).toBe(false);
    });

    it("keeps the hook's own retries and delay for other errors", () => {
        const { retry, retryDelay } = getMemoryReportRetry(2, (failureCount) => failureCount * 100);

        expect(retry(1, serverError)).toBe(true);
        expect(retry(2, serverError)).toBe(false);
        expect(retryDelay(1, serverError)).toBe(100);
    });

    it("defaults to TanStack Query's own delay", () => {
        const { retryDelay } = getMemoryReportRetry(3);

        expect([0, 1, 5].map((failureCount) => retryDelay(failureCount, serverError))).toEqual([1000, 2000, 30_000]);
    });
});
