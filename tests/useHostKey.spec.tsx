// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useHostKey from '../src/hooks/useHostKey';
import Endpoints from '../src/definitions/Endpoints';

const { getServerConfigMock, SERVER_CONFIG } = vi.hoisted(() => {
    const config = { SERVER_MODE: false };

    return { getServerConfigMock: vi.fn(() => config), SERVER_CONFIG: config };
});

const postMock = vi.hoisted(() => vi.fn());

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/libs/axiosInstance', () => ({
    default: { post: postMock },
}));

const TARGET = { host: 'aus-wh-05', port: 45985 };
const FINGERPRINT = 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU';

afterEach(() => {
    vi.clearAllMocks();
});

beforeEach(() => {
    SERVER_CONFIG.SERVER_MODE = false;
    getServerConfigMock.mockReturnValue(SERVER_CONFIG);
});

describe('useHostKey', () => {
    it('posts the target to the host-key endpoint', async () => {
        postMock.mockResolvedValue({ data: { host: 'aus-wh-05', port: 45985, offers: [] } });

        const { result } = renderHook(() => useHostKey());
        await result.current.fetchHostKeyOffer(TARGET);

        expect(postMock).toHaveBeenCalledWith(Endpoints.REMOTE_HOST_KEY, TARGET);
    });

    it('drops an offer entry missing the fields the user compares', async () => {
        postMock.mockResolvedValue({
            data: {
                host: 'aus-wh-05',
                port: 45985,
                offers: [
                    { keyType: 'ssh-ed25519', fingerprint: FINGERPRINT, line: 'a' },
                    // No fingerprint: rendering this would put a trust button next to
                    // nothing the user could check.
                    { keyType: 'ssh-rsa', line: 'b' },
                ],
            },
        });

        const { result } = renderHook(() => useHostKey());
        const offer = await result.current.fetchHostKeyOffer(TARGET);

        expect(offer?.offers).toHaveLength(1);
        expect(offer?.offers[0].fingerprint).toBe(FINGERPRINT);
    });

    it('tolerates a response with no offers key at all', async () => {
        postMock.mockResolvedValue({ data: { host: 'aus-wh-05', port: 45985 } });

        const { result } = renderHook(() => useHostKey());
        const offer = await result.current.fetchHostKeyOffer(TARGET);

        expect(offer?.offers).toEqual([]);
    });

    it('posts the fingerprints the user saw when trusting', async () => {
        postMock.mockResolvedValue({ data: {} });

        const { result } = renderHook(() => useHostKey());
        await result.current.trustHostKey(TARGET, [FINGERPRINT]);

        expect(postMock).toHaveBeenCalledWith(`${Endpoints.REMOTE_HOST_KEY}/trust`, {
            target: TARGET,
            fingerprints: [FINGERPRINT],
        });
    });

    describe('under SERVER_MODE', () => {
        it('makes no request the backend would refuse', async () => {
            SERVER_CONFIG.SERVER_MODE = true;

            const { result } = renderHook(() => useHostKey());

            expect(await result.current.fetchHostKeyOffer(TARGET)).toBeNull();
            expect(result.current.isHostKeyTrustAvailable).toBe(false);
            expect(postMock).not.toHaveBeenCalled();
        });

        it('never writes to the server known_hosts', async () => {
            SERVER_CONFIG.SERVER_MODE = true;

            const { result } = renderHook(() => useHostKey());
            await result.current.trustHostKey(TARGET, [FINGERPRINT]);

            expect(postMock).not.toHaveBeenCalled();
        });
    });
});
