// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, HttpStatusCode } from 'axios';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NPEFileLoader from '../src/components/npe/NPEFileLoader';
import { ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { ReportKind, ReportLoadFailureReason } from '../src/definitions/UsageEvent';

const uploadNpeFile = vi.fn();
const { recordReportLoadFailed } = vi.hoisted(() => ({ recordReportLoadFailed: vi.fn() }));

vi.mock('../src/hooks/useLocal', () => ({
    default: () => ({ uploadNpeFile }),
}));

vi.mock('../src/functions/reportLoadUsage', async (importOriginal) => {
    const { reportLoadUsageSpiesMock } = await import('./helpers/mockReportLoadUsage');

    return reportLoadUsageSpiesMock(importOriginal, vi.fn(), recordReportLoadFailed);
});

vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const renderLoader = () => {
    const client = new QueryClient();
    client.setQueryData(['npe-summary', 'old-report'], {});
    client.setQueryData(['npe-window', 'old-report', 0], {});
    client.setQueryData(['fetch-npe', 'old-report'], {});
    client.setQueryData(['unrelated-query'], {});
    const removeQueries = vi.spyOn(client, 'removeQueries');
    const onUploadAccepted = vi.fn();
    const utils = render(
        <QueryClientProvider client={client}>
            <NPEFileLoader onUploadAccepted={onUploadAccepted} />
        </QueryClientProvider>,
    );
    return { ...utils, client, removeQueries, onUploadAccepted };
};

describe('NPEFileLoader re-upload cache-bust', () => {
    it('does not record cancelling the file picker as a failed load', () => {
        const { container } = renderLoader();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;

        fireEvent.change(input, { target: { files: [] } });

        expect(uploadNpeFile).not.toHaveBeenCalled();
        expect(recordReportLoadFailed).not.toHaveBeenCalled();
    });

    it('drops the NPE summary / window / trace caches on a successful upload', async () => {
        uploadNpeFile.mockResolvedValue({ data: { status: ConnectionTestStates.OK } });
        const { container, client, removeQueries, onUploadAccepted } = renderLoader();

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [new File(['x'], 'report.npeviz.zst')] } });

        await waitFor(() => expect(removeQueries).toHaveBeenCalled());

        // staleTime: Infinity means a same-name re-upload would otherwise serve the
        // previous report — all three windowed keys must be evicted.
        expect(removeQueries).toHaveBeenCalledTimes(1);
        expect(client.getQueryData(['npe-summary', 'old-report'])).toBeUndefined();
        expect(client.getQueryData(['npe-window', 'old-report', 0])).toBeUndefined();
        expect(client.getQueryData(['fetch-npe', 'old-report'])).toBeUndefined();
        expect(client.getQueryData(['unrelated-query'])).toEqual({});
        expect(onUploadAccepted).toHaveBeenCalledTimes(1);
    });

    it('does not bust caches when the upload fails', async () => {
        uploadNpeFile.mockResolvedValue({ data: { status: ConnectionTestStates.FAILED, message: 'bad file' } });
        const { container, removeQueries } = renderLoader();

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [new File(['x'], 'report.npeviz.zst')] } });

        await waitFor(() => expect(uploadNpeFile).toHaveBeenCalled());
        expect(removeQueries).not.toHaveBeenCalled();
        expect(recordReportLoadFailed).toHaveBeenCalledWith(ReportKind.NPE, ReportLoadFailureReason.OTHER);
    });

    it('classifies an upload 404 as missing_file without recording the body', async () => {
        const error = new AxiosError('gone');
        error.status = HttpStatusCode.NotFound;
        error.response = {
            status: HttpStatusCode.NotFound,
            data: { error: 'private response message' },
            statusText: '',
            headers: {},
            config: error.config!,
        };
        uploadNpeFile.mockRejectedValue(error);
        const { container } = renderLoader();

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [new File(['x'], 'report.npeviz.zst')] } });

        await waitFor(() =>
            expect(recordReportLoadFailed).toHaveBeenCalledWith(ReportKind.NPE, ReportLoadFailureReason.MISSING_FILE),
        );
        expect(JSON.stringify(recordReportLoadFailed.mock.calls)).not.toContain('private response message');
    });
});
