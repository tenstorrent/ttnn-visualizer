// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, HttpStatusCode } from 'axios';
import { fetchNpeText, useNPETimelineFile, useNpe, useNpeSummary, useNpeWindow } from '../src/hooks/useAPI';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { NPE_QUERY_KEY, NPE_TIMELINE_QUERY_KEY, NpeClientErrorKind } from '../src/definitions/NPEData';
import { minimalValidNpeData } from './helpers/npeFixtures';

const h = vi.hoisted(() => ({
    instanceId: 'test-instance',
}));

vi.mock('../src/libs/axiosInstance', () => ({
    default: { get: vi.fn() },
    getOrCreateInstanceId: () => h.instanceId,
}));

const mockedGet = vi.mocked(axiosInstance.get);

// A fresh client per render so cached results don't bleed across cases; retry off
// so a rejected fetch settles to `isError` immediately.
const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const makeWrapper = (client = makeClient()) => {
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
    h.instanceId = 'test-instance';
    vi.clearAllMocks();
});

describe('useNpeSummary / useNpeWindow fetch-boundary validation', () => {
    it('resolves a well-shaped summary body', async () => {
        mockedGet.mockResolvedValue({ data: validSummary });
        const { result } = renderHook(() => useNpeSummary('trace.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.n_timesteps).toBe(2);
    });

    it('rejects a length-mismatched summary as a synthetic 422 AxiosError', async () => {
        const bad = { ...validSummary, timesteps: { ...validSummary.timesteps, active_count: [0] } };
        mockedGet.mockResolvedValue({ data: bad });
        const { result } = renderHook(() => useNpeSummary('trace.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.code).toBe(AxiosError.ERR_BAD_RESPONSE);
        expect(result.current.error?.status).toBe(HttpStatusCode.UnprocessableEntity);
        expect(result.current.error?.response?.data).toEqual({ kind: NpeClientErrorKind.SHAPE });
        expect(result.current.error?.message).toMatch(/active_count/);
    });

    it('resolves a well-shaped window body', async () => {
        mockedGet.mockResolvedValue({ data: validWindow });
        const { result } = renderHook(() => useNpeWindow('trace.json', 1), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.t).toBe(1);
    });

    it('rejects a malformed window as a synthetic 422 AxiosError', async () => {
        const bad = { ...validWindow, timestep: { ...validWindow.timestep, link_demand: 'nope' } };
        mockedGet.mockResolvedValue({ data: bad });
        const { result } = renderHook(() => useNpeWindow('trace.json', 1), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.code).toBe(AxiosError.ERR_BAD_RESPONSE);
        expect(result.current.error?.status).toBe(HttpStatusCode.UnprocessableEntity);
        expect(result.current.error?.response?.data).toEqual({ kind: NpeClientErrorKind.SHAPE });
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

describe('useNpe / useNPETimelineFile whole-file text fetch', () => {
    it('fetches NPE as text with forcedJSONParsing disabled', async () => {
        mockedGet.mockResolvedValue({ data: JSON.stringify(minimalValidNpeData) });
        const { result } = renderHook(() => useNpe('trace.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockedGet).toHaveBeenCalledWith(
            Endpoints.NPE,
            expect.objectContaining({
                responseType: 'text',
                transitional: { forcedJSONParsing: false },
                signal: expect.any(AbortSignal),
            }),
        );
        expect(result.current.data?.common_info.version).toBe('1.0.0');
    });

    it('maps an empty body to HTTP 422 on useNpe', async () => {
        mockedGet.mockResolvedValue({ data: null });
        const { result } = renderHook(() => useNpe('trace.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.status).toBe(HttpStatusCode.UnprocessableEntity);
        expect(result.current.error?.code).toBe(AxiosError.ERR_BAD_RESPONSE);
        expect(result.current.error?.response?.data).toEqual({ kind: NpeClientErrorKind.PARSE });
    });

    it('maps a malformed JSON string body to HTTP 422 on useNpe', async () => {
        mockedGet.mockResolvedValue({ data: '{not-json' });
        const { result } = renderHook(() => useNpe('trace.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.status).toBe(HttpStatusCode.UnprocessableEntity);
        expect(result.current.error?.code).toBe(AxiosError.ERR_BAD_RESPONSE);
        expect(result.current.error?.response?.data).toEqual({ kind: NpeClientErrorKind.PARSE });
    });

    it('fetches timeline with filename param and the same text options', async () => {
        mockedGet.mockResolvedValue({ data: JSON.stringify(minimalValidNpeData) });
        const { result } = renderHook(() => useNPETimelineFile('saved.json'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockedGet).toHaveBeenCalledWith(
            `${Endpoints.PERFORMANCE}/npe/timeline`,
            expect.objectContaining({
                responseType: 'text',
                params: { filename: 'saved.json' },
                signal: expect.any(AbortSignal),
            }),
        );
    });

    it('includes instanceId in the useNpe query key', async () => {
        mockedGet.mockResolvedValue({ data: JSON.stringify(minimalValidNpeData) });
        h.instanceId = 'instance-a';
        const client = makeClient();
        const { result } = renderHook(() => useNpe('trace.json'), { wrapper: makeWrapper(client) });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(
            client
                .getQueryCache()
                .getAll()
                .map((query) => query.queryKey),
        ).toEqual([[NPE_QUERY_KEY, 'instance-a', 'trace.json']]);
    });

    it('includes instanceId in the timeline query key', async () => {
        mockedGet.mockResolvedValue({ data: JSON.stringify(minimalValidNpeData) });
        h.instanceId = 'instance-b';
        const client = makeClient();
        const { result } = renderHook(() => useNPETimelineFile('saved.json'), {
            wrapper: makeWrapper(client),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(
            client
                .getQueryCache()
                .getAll()
                .map((query) => query.queryKey),
        ).toEqual([[NPE_TIMELINE_QUERY_KEY, 'instance-b', 'saved.json']]);
    });

    it('does not reuse the useNpe cache across instanceIds for the same basename', async () => {
        mockedGet.mockResolvedValue({ data: JSON.stringify(minimalValidNpeData) });
        const client = makeClient();
        const wrapper = makeWrapper(client);

        h.instanceId = 'instance-a';
        const first = renderHook(() => useNpe('trace.json'), { wrapper });
        await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
        first.unmount();

        expect(client.getQueryData([NPE_QUERY_KEY, 'instance-a', 'trace.json'])).toEqual(minimalValidNpeData);
        expect(client.getQueryData([NPE_QUERY_KEY, 'instance-b', 'trace.json'])).toBeUndefined();

        mockedGet.mockClear();
        mockedGet.mockResolvedValue({ data: JSON.stringify(minimalValidNpeData) });
        h.instanceId = 'instance-b';
        const second = renderHook(() => useNpe('trace.json'), { wrapper });
        await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
        expect(mockedGet).toHaveBeenCalledTimes(1);
        expect(client.getQueryData([NPE_QUERY_KEY, 'instance-b', 'trace.json'])).toEqual(minimalValidNpeData);
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
        mockedGet.mockResolvedValueOnce({ data: JSON.stringify(minimalValidNpeData) });

        const first = fetchNpeText(Endpoints.NPE);
        const second = fetchNpeText(Endpoints.NPE);
        await expect(second).resolves.toEqual(minimalValidNpeData);
        await expect(first).rejects.toThrow();
        // Keep the first promise from hanging if abort listener never fired in the mock.
        resolveFirst?.({ data: JSON.stringify(minimalValidNpeData) });
    });
});
