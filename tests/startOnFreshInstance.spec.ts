// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startOnFreshInstance } from '../src/libs/axiosInstance';

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => ({ SERVER_MODE: true, BASE_PATH: '/' }),
}));

const refusal = (status: number, data: unknown) =>
    new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
        status,
        data,
    } as AxiosResponse);

const notOwned = () =>
    refusal(403, { error: 'This instance belongs to another session.', reason: 'instance_not_owned' });

beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('instanceId', 'stale');
    window.history.replaceState(null, '', '/operations?instanceId=stale&tab=1');
});

afterEach(() => window.history.replaceState(null, '', '/'));

describe('startOnFreshInstance', () => {
    it('drops the refused instance ID and reloads without it', () => {
        const reload = vi.fn();

        expect(startOnFreshInstance(notOwned(), reload, 1_000_000)).toBe(true);

        expect(sessionStorage.getItem('instanceId')).toBeNull();
        expect(reload).toHaveBeenCalledOnce();
        const url: URL = reload.mock.calls[0][0];
        expect(url.pathname).toBe('/operations');
        expect(url.searchParams.has('instanceId')).toBe(false);
        expect(url.searchParams.get('tab')).toBe('1');
    });

    it('ignores other refusals', () => {
        const reload = vi.fn();

        expect(startOnFreshInstance(refusal(403, { error: 'Endpoint not accessible' }), reload)).toBe(false);
        expect(startOnFreshInstance(refusal(500, { reason: 'instance_not_owned' }), reload)).toBe(false);
        expect(startOnFreshInstance(new Error('network'), reload)).toBe(false);

        expect(reload).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('instanceId')).toBe('stale');
    });

    it('reloads at most once a minute, so a browser without cookies cannot loop', () => {
        const reload = vi.fn();

        expect(startOnFreshInstance(notOwned(), reload, 1_000_000)).toBe(true);
        expect(startOnFreshInstance(notOwned(), reload, 1_030_000)).toBe(false);
        expect(startOnFreshInstance(notOwned(), reload, 1_061_000)).toBe(true);

        expect(reload).toHaveBeenCalledTimes(2);
    });
});
