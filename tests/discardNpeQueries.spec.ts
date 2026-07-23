// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
    NPE_OP_TRACE_QUERY_KEY,
    NPE_TIMELINE_QUERY_KEY,
    abortActiveNpeRequest,
    discardNpeQueries,
    fetchNpeText,
} from '../src/hooks/useAPI';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { NPE_FETCH_TIMEOUT_MS, NPE_MAX_CONTENT_LENGTH } from '../src/definitions/NPEData';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
}));

const validPayload = {
    common_info: { version: '1.0.0' },
    noc_transfers: [{ id: 0 }],
    timestep_data: [{ active_transfers: [] }],
};

describe('discardNpeQueries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        abortActiveNpeRequest();
    });

    it('aborts the active request and cancels/removes both NPE query keys', async () => {
        const queryClient = new QueryClient();
        const cancelSpy = vi.spyOn(queryClient, 'cancelQueries').mockResolvedValue(undefined);
        const removeSpy = vi.spyOn(queryClient, 'removeQueries');

        // Seed an in-flight abort controller via fetchNpeText, then discard mid-flight.
        let resolveGet: ((value: unknown) => void) | undefined;
        vi.mocked(axiosInstance.get).mockImplementation(
            (_url, config) =>
                new Promise((resolve, reject) => {
                    resolveGet = resolve;
                    const signal = config?.signal;
                    signal?.addEventListener?.('abort', () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    });
                }) as ReturnType<typeof axiosInstance.get>,
        );

        const fetchPromise = fetchNpeText(Endpoints.NPE);
        discardNpeQueries(queryClient);

        expect(cancelSpy).toHaveBeenCalledWith({ queryKey: NPE_OP_TRACE_QUERY_KEY });
        expect(cancelSpy).toHaveBeenCalledWith({ queryKey: NPE_TIMELINE_QUERY_KEY });
        expect(removeSpy).toHaveBeenCalledWith({ queryKey: NPE_OP_TRACE_QUERY_KEY });
        expect(removeSpy).toHaveBeenCalledWith({ queryKey: NPE_TIMELINE_QUERY_KEY });

        await expect(fetchPromise).rejects.toThrow();
        resolveGet?.({ data: JSON.stringify(validPayload) });
    });
});

describe('fetchNpeText', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        abortActiveNpeRequest();
    });

    it('requests text with timeout, disabled forced JSON parsing, and content-length caps', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue({ data: JSON.stringify(validPayload) });

        const result = await fetchNpeText(Endpoints.NPE);

        expect(result).toEqual(validPayload);
        expect(axiosInstance.get).toHaveBeenCalledWith(
            Endpoints.NPE,
            expect.objectContaining({
                timeout: NPE_FETCH_TIMEOUT_MS,
                responseType: 'text',
                transitional: { forcedJSONParsing: false },
                maxContentLength: NPE_MAX_CONTENT_LENGTH,
                maxBodyLength: NPE_MAX_CONTENT_LENGTH,
                signal: expect.any(AbortSignal),
            }),
        );
    });
});
