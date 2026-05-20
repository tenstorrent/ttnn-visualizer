// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosResponse } from 'axios';
import { StackSourceOrigin } from '../src/definitions/StackTrace';
import useRemoteConnection from '../src/hooks/useRemote';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
});

afterEach(() => {
    window.localStorage.clear();
});

describe('useRemoteConnection - stack source GETs', () => {
    it('isSourceFileAvailable issues GET /api/remote/stack-trace/test with filePath query and forwards signal', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: { available: true, source: StackSourceOrigin.Path },
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const controller = new AbortController();
        const availability = await result.current.isSourceFileAvailable('/some/file.py', controller.signal);

        expect(availability).toEqual({ available: true, source: StackSourceOrigin.Path });
        expect(mockGet).toHaveBeenCalledTimes(1);
        const [url, config] = mockGet.mock.calls[0];
        expect(url).toBe('/api/remote/stack-trace/test');
        expect(config).toMatchObject({
            params: { filePath: '/some/file.py' },
            signal: controller.signal,
        });
    });

    it('isSourceFileAvailable returns unavailable when the request rejects', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockRejectedValue(new Error('boom'));

        const { result } = renderHook(() => useRemoteConnection());
        const availability = await result.current.isSourceFileAvailable('/x');

        expect(availability).toEqual({ available: false, source: null });
    });

    it('isSourceFileAvailable returns unavailable when the response shape is unexpected', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({ data: { available: 'maybe' } } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const availability = await result.current.isSourceFileAvailable('/x');

        expect(availability).toEqual({ available: false, source: null });
    });

    it('readRemoteFile issues GET /api/remote/stack-trace/read and parses X-TTNN-Resolved-Source-Path', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: 'file contents',
            headers: {
                'x-ttnn-resolved-source-path': '/abs/resolved.py',
            },
        } as unknown as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const out = await result.current.readRemoteFile('/some/file.py');

        expect(mockGet).toHaveBeenCalledWith('/api/remote/stack-trace/read', {
            params: { filePath: '/some/file.py' },
            responseType: 'text',
        });
        expect(out).toEqual({
            data: 'file contents',
            error: null,
            resolvedPath: '/abs/resolved.py',
        });
    });

    it('readRemoteFile reports null resolvedPath when header is absent', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: 'plain',
            headers: {},
        } as unknown as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const out = await result.current.readRemoteFile('/x');

        expect(out.data).toBe('plain');
        expect(out.resolvedPath).toBeNull();
        expect(out.error).toBeNull();
    });

    it('readRemoteFile returns the standard error shape when the GET fails', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockRejectedValue(new Error('boom'));

        const { result } = renderHook(() => useRemoteConnection());
        const out = await result.current.readRemoteFile('/x');

        expect(out.data).toBeNull();
        expect(out.resolvedPath).toBeNull();
        expect(typeof out.error).toBe('string');
    });
});
