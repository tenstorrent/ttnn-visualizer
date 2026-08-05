// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import Endpoints from '../src/definitions/Endpoints';
import { getSshConfigHostLabel } from '../src/functions/formatting';
import useSshConfigHosts from '../src/hooks/useSshConfigHosts';
import axiosInstance from '../src/libs/axiosInstance';
import { MOCK_SSH_CONFIG_HOST } from './helpers/sshConfigFixtures';

const getServerConfigMock = vi.hoisted(() => vi.fn(() => ({ SERVER_MODE: false })));

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/libs/axiosInstance', () => ({
    default: { get: vi.fn() },
}));

const mockedGet = vi.mocked(axiosInstance.get);

// A fresh client per render so cached results don't bleed across cases. Retry policy
// comes from the hook itself, so it is deliberately not overridden here.
const makeWrapper = (client = new QueryClient()) => {
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
};

beforeEach(() => {
    getServerConfigMock.mockReturnValue({ SERVER_MODE: false });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('useSshConfigHosts', () => {
    it('passes a well-shaped payload through', async () => {
        mockedGet.mockResolvedValue({ data: { configExists: true, hosts: [MOCK_SSH_CONFIG_HOST] } });

        const { result } = renderHook(() => useSshConfigHosts(), { wrapper: makeWrapper() });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockedGet).toHaveBeenCalledWith(Endpoints.REMOTE_SSH_CONFIG_HOSTS);
        expect(result.current.data).toEqual({ configExists: true, hosts: [MOCK_SSH_CONFIG_HOST] });
        expect(getSshConfigHostLabel(MOCK_SSH_CONFIG_HOST)).toBe('work-gpu — gpu.example.com');
    });

    it('collapses a payload whose hosts are not an array', async () => {
        mockedGet.mockResolvedValue({ data: { configExists: true, hosts: 'nope' } });

        const { result } = renderHook(() => useSshConfigHosts(), { wrapper: makeWrapper() });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({ configExists: false, hosts: [] });
    });

    it('drops malformed host entries rather than rendering them', async () => {
        // The picker dereferences host.host while building its options, so one junk entry
        // would otherwise throw and take the whole dialog down.
        mockedGet.mockResolvedValue({
            data: { configExists: true, hosts: [null, 'work-gpu', { port: 22 }, MOCK_SSH_CONFIG_HOST] },
        });

        const { result } = renderHook(() => useSshConfigHosts(), { wrapper: makeWrapper() });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({ configExists: true, hosts: [MOCK_SSH_CONFIG_HOST] });
    });

    it('collapses a null body', async () => {
        mockedGet.mockResolvedValue({ data: null });

        const { result } = renderHook(() => useSshConfigHosts(), { wrapper: makeWrapper() });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({ configExists: false, hosts: [] });
    });

    it('coerces a non-boolean configExists', async () => {
        mockedGet.mockResolvedValue({ data: { configExists: 'yes', hosts: [] } });

        const { result } = renderHook(() => useSshConfigHosts(), { wrapper: makeWrapper() });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({ configExists: true, hosts: [] });
    });

    it('never requests the local-only endpoint under SERVER_MODE', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        const { result } = renderHook(() => useSshConfigHosts(), { wrapper: makeWrapper() });

        expect(result.current.isPending).toBe(true);
        expect(result.current.fetchStatus).toBe('idle');
        expect(mockedGet).not.toHaveBeenCalled();
    });

    it('does not fetch while disabled by the caller', () => {
        const { result } = renderHook(() => useSshConfigHosts(false), { wrapper: makeWrapper() });

        expect(result.current.fetchStatus).toBe('idle');
        expect(mockedGet).not.toHaveBeenCalled();
    });

    it('fails without retrying, so a broken config is not re-parsed', async () => {
        mockedGet.mockRejectedValue(new AxiosError('boom'));

        const { result } = renderHook(() => useSshConfigHosts(), { wrapper: makeWrapper() });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(mockedGet).toHaveBeenCalledTimes(1);
    });

    it('refetches on mount so ~/.ssh/config edits appear when the dialog reopens', async () => {
        mockedGet.mockResolvedValue({ data: { configExists: true, hosts: [] } });
        const wrapper = makeWrapper(new QueryClient());

        const first = renderHook(() => useSshConfigHosts(), { wrapper });
        await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
        first.unmount();

        const second = renderHook(() => useSshConfigHosts(), { wrapper });
        await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

        expect(mockedGet).toHaveBeenCalledTimes(2);
    });
});
