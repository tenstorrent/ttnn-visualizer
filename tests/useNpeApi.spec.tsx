// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNpeText, useNPETimelineFile, useNpe, useNpeSummary, useNpeWindow } from '../src/hooks/useAPI';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { NPEAxiosErrorCode, NPE_FETCH_TIMEOUT_MS, NPE_MAX_CONTENT_LENGTH } from '../src/definitions/NPEData';

vi.mock('../src/libs/axiosInstance', () => ({
    default: { get: vi.fn() },
    getOrCreateInstanceId: () => 'test-instance',
}));

const mockedGet = vi.mocked(axiosInstance.get);

// A fresh client per render so cached results don't bleed across cases; retry off
// so a rejected fetch settles to `isError` immediately.
const makeWrapper = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
};

const validSummary = {
    common_info: { version: '1.0.0' },
    chips: {},
    zones: [],
    n_timesteps: 2,
    timesteps: {
        start_cycle: [0, 10],
        end_cycle: [9, 19],
        avg_link_demand: [1, 2],
        avg_link_util: [3, 4],
        max_link_demand: [5, 6],
        mcast_write_link_util: [0.1, 0.2],
        active_count: [0, 1],
    },
};

const validWindow = {
    t: 1,
    transfers: [],
    timestep: {
        active_transfers: [],
        link_demand: [],
        avg_link_demand: 0,
        avg_link_util: 0,
        mcast_write_link_util: 0,
        noc: {},
    },
};

afterEach(() => {
    vi.clearAllMocks();
});

describe('useNpeSummary / useNpeWindow fetch-boundary validation', () => {
    it('resolves a well-shaped summary body', async () => {
        mockedGet.mockResolvedValue({ data: validSummary });
        const { result } = renderHook(() => useNpeSummary('trace.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.n_timesteps).toBe(2);
    });

    it('rejects a length-mismatched summary as an ERR_INVALID_RESPONSE AxiosError', async () => {
        const bad = { ...validSummary, timesteps: { ...validSummary.timesteps, active_count: [0] } };
        mockedGet.mockResolvedValue({ data: bad });
        const { result } = renderHook(() => useNpeSummary('trace.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.code).toBe('ERR_INVALID_RESPONSE');
        expect(result.current.error?.message).toMatch(/active_count/);
    });

    it('resolves a well-shaped window body', async () => {
        mockedGet.mockResolvedValue({ data: validWindow });
        const { result } = renderHook(() => useNpeWindow('trace.json', 1), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.t).toBe(1);
    });

    it('rejects a malformed window as an ERR_INVALID_RESPONSE AxiosError', async () => {
        const bad = { ...validWindow, timestep: { ...validWindow.timestep, link_demand: 'nope' } };
        mockedGet.mockResolvedValue({ data: bad });
        const { result } = renderHook(() => useNpeWindow('trace.json', 1), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.code).toBe('ERR_INVALID_RESPONSE');
        expect(result.current.error?.message).toMatch(/link_demand array/);
    });

    it('threads the AbortSignal from React Query into axios', async () => {
        mockedGet.mockResolvedValue({ data: validWindow });
        renderHook(() => useNpeWindow('trace.json', 1), { wrapper: makeWrapper() });
        await waitFor(() => expect(mockedGet).toHaveBeenCalled());
        const config = mockedGet.mock.calls[0][1] as { signal?: AbortSignal };
        expect(config.signal).toBeInstanceOf(AbortSignal);
    });
});

const validNpePayload = {
    common_info: { version: '1.0.0' },
    noc_transfers: [{ id: 0 }],
    timestep_data: [{ active_transfers: [] }],
};

describe('useNpe / useNPETimelineFile whole-file text fetch', () => {
    it('fetches NPE as text with timeout and content-length options', async () => {
        mockedGet.mockResolvedValue({ data: JSON.stringify(validNpePayload) });
        const { result } = renderHook(() => useNpe('trace.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockedGet).toHaveBeenCalledWith(
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
        expect(result.current.data?.common_info.version).toBe('1.0.0');
    });

    it('maps an empty body to PAYLOAD_TOO_LARGE on useNpe', async () => {
        mockedGet.mockResolvedValue({ data: null });
        const { result } = renderHook(() => useNpe('trace.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.code).toBe(NPEAxiosErrorCode.PAYLOAD_TOO_LARGE);
    });

    it('fetches timeline with filename param and the same text options', async () => {
        mockedGet.mockResolvedValue({ data: JSON.stringify(validNpePayload) });
        const { result } = renderHook(() => useNPETimelineFile('saved.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockedGet).toHaveBeenCalledWith(
            `${Endpoints.PERFORMANCE}/npe/timeline`,
            expect.objectContaining({
                timeout: NPE_FETCH_TIMEOUT_MS,
                responseType: 'text',
                params: { filename: 'saved.json' },
                signal: expect.any(AbortSignal),
            }),
        );
    });

    it('aborts the prior in-flight fetch when a second fetchNpeText starts', async () => {
        let resolveFirst: ((value: { data: string }) => void) | undefined;
        mockedGet.mockImplementationOnce((_url, config) => {
            return new Promise((resolve, reject) => {
                resolveFirst = resolve;
                const signal = config?.signal as AbortSignal | undefined;
                signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            });
        });
        mockedGet.mockResolvedValueOnce({ data: JSON.stringify(validNpePayload) });

        const first = fetchNpeText(Endpoints.NPE);
        const second = fetchNpeText(Endpoints.NPE);
        await expect(second).resolves.toEqual(validNpePayload);
        await expect(first).rejects.toThrow();
        // Keep the first promise from hanging if abort listener never fired in the mock.
        resolveFirst?.({ data: JSON.stringify(validNpePayload) });
    });
});
