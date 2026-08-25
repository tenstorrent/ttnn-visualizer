// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NPEFileLoader from '../src/components/npe/NPEFileLoader';
import { ConnectionTestStates } from '../src/definitions/ConnectionStatus';

const uploadNpeFile = vi.fn();

vi.mock('../src/hooks/useLocal', () => ({
    default: () => ({ uploadNpeFile }),
}));

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
    const removeQueries = vi.spyOn(client, 'removeQueries');
    const utils = render(
        <QueryClientProvider client={client}>
            <NPEFileLoader />
        </QueryClientProvider>,
    );
    return { ...utils, removeQueries };
};

describe('NPEFileLoader re-upload cache-bust', () => {
    it('drops the NPE summary / window / trace caches on a successful upload', async () => {
        uploadNpeFile.mockResolvedValue({ data: { status: ConnectionTestStates.OK } });
        const { container, removeQueries } = renderLoader();

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [new File(['x'], 'report.npeviz.zst')] } });

        await waitFor(() => expect(removeQueries).toHaveBeenCalled());

        const removedKeys = removeQueries.mock.calls.map((call) => (call[0] as { queryKey: string[] }).queryKey[0]);
        // staleTime: Infinity means a same-name re-upload would otherwise serve the
        // previous report — all three windowed keys must be evicted.
        expect(removedKeys).toEqual(expect.arrayContaining(['npe-summary', 'npe-window', 'fetch-npe']));
    });

    it('does not bust caches when the upload fails', async () => {
        uploadNpeFile.mockResolvedValue({ data: { status: ConnectionTestStates.FAILED, message: 'bad file' } });
        const { container, removeQueries } = renderLoader();

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [new File(['x'], 'report.npeviz.zst')] } });

        await waitFor(() => expect(uploadNpeFile).toHaveBeenCalled());
        expect(removeQueries).not.toHaveBeenCalled();
    });
});
