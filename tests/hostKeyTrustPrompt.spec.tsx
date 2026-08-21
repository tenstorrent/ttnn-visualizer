// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HostKeyTrustPrompt from '../src/components/report-selection/HostKeyTrustPrompt';
import {
    HOST_KEY_CHANGED_TITLE,
    HOST_KEY_PROXIED_NOTICE,
    HOST_KEY_TRUST_BUTTON_LABEL,
    HOST_KEY_TRUST_ON_FIRST_USE_NOTICE,
    HOST_KEY_UNKNOWN_TITLE,
} from '../src/definitions/ConnectionDialog';
import { HostKeyIssue } from '../src/definitions/HostKey';
import { TEST_IDS } from '../src/definitions/TestIds';
import { HostKeyOfferResponse, HostKeyStatus } from '../src/model/HostKey';

const { getServerConfigMock, SERVER_CONFIG } = vi.hoisted(() => {
    const config = { SERVER_MODE: false };

    return { getServerConfigMock: vi.fn(() => config), SERVER_CONFIG: config };
});

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

const ED25519_FINGERPRINT = 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU';
const ECDSA_FINGERPRINT = 'SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM';

const UNKNOWN_HOST_KEY: HostKeyStatus = {
    issue: HostKeyIssue.UNKNOWN,
    host: 'aus-wh-05',
    port: 45985,
};

const CHANGED_HOST_KEY: HostKeyStatus = {
    issue: HostKeyIssue.CHANGED,
    host: 'aus-wh-05',
    port: 45985,
    knownHostsEntry: '/home/u/.ssh/known_hosts:3',
};

const offerResponse = (overrides: Partial<HostKeyOfferResponse> = {}): HostKeyOfferResponse => ({
    issue: HostKeyIssue.UNKNOWN,
    host: 'aus-wh-05',
    port: 45985,
    offers: [{ keyType: 'ssh-ed25519', fingerprint: ED25519_FINGERPRINT, line: 'line' }],
    ...overrides,
});

// A fresh client per render: the shared helper's module-level client would carry an
// offer keyed on host+port from one test into the next.
const renderPrompt = (props: Parameters<typeof HostKeyTrustPrompt>[0]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    return render(<HostKeyTrustPrompt {...props} />, { wrapper: Wrapper });
};

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    getServerConfigMock.mockClear();
    SERVER_CONFIG.SERVER_MODE = false;
    getServerConfigMock.mockReturnValue(SERVER_CONFIG);
});

describe('HostKeyTrustPrompt for an unknown host key', () => {
    it('shows the offered key type and fingerprint', async () => {
        renderPrompt({
            hostKey: UNKNOWN_HOST_KEY,
            onRequestOffer: vi.fn().mockResolvedValue(offerResponse()),
            onTrust: vi.fn(),
        });

        expect(screen.getByText(HOST_KEY_UNKNOWN_TITLE)).toBeInTheDocument();

        await waitFor(() => expect(screen.getByText(ED25519_FINGERPRINT)).toBeInTheDocument());
        expect(screen.getByText('ssh-ed25519')).toBeInTheDocument();
    });

    it('says plainly that trusting a fetched key proves nothing', async () => {
        renderPrompt({
            hostKey: UNKNOWN_HOST_KEY,
            onRequestOffer: vi.fn().mockResolvedValue(offerResponse()),
            onTrust: vi.fn(),
        });

        await waitFor(() => expect(screen.getByText(HOST_KEY_TRUST_ON_FIRST_USE_NOTICE)).toBeInTheDocument());
    });

    it('passes the fingerprints the user was shown when trusting', async () => {
        const onTrust = vi.fn().mockResolvedValue(undefined);

        renderPrompt({
            hostKey: UNKNOWN_HOST_KEY,
            onRequestOffer: vi.fn().mockResolvedValue(
                offerResponse({
                    offers: [
                        { keyType: 'ssh-ed25519', fingerprint: ED25519_FINGERPRINT, line: 'a' },
                        { keyType: 'ecdsa-sha2-nistp256', fingerprint: ECDSA_FINGERPRINT, line: 'b' },
                    ],
                }),
            ),
            onTrust,
        });

        await waitFor(() => expect(screen.getByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON));

        // Echoed back so the endpoint can refuse a key swapped since the preview.
        await waitFor(() => expect(onTrust).toHaveBeenCalledWith([ED25519_FINGERPRINT, ECDSA_FINGERPRINT]));
    });

    it('offers no button until a key has actually been fetched', async () => {
        renderPrompt({
            hostKey: UNKNOWN_HOST_KEY,
            onRequestOffer: vi.fn().mockResolvedValue(offerResponse({ offers: [] })),
            onTrust: vi.fn(),
        });

        await waitFor(() => expect(screen.getByText(HOST_KEY_UNKNOWN_TITLE)).toBeInTheDocument());
        expect(screen.queryByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).not.toBeInTheDocument();
    });

    it('surfaces a failed trust without claiming the host was trusted', async () => {
        renderPrompt({
            hostKey: UNKNOWN_HOST_KEY,
            onRequestOffer: vi.fn().mockResolvedValue(offerResponse()),
            onTrust: vi.fn().mockRejectedValue({
                isAxiosError: true,
                response: { status: 422, data: { error: 'A host key is already recorded' } },
            }),
        });

        await waitFor(() => expect(screen.getByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON));

        await waitFor(() => expect(screen.getByText('A host key is already recorded')).toBeInTheDocument());
    });

    it('explains a jump host instead of offering an action it cannot perform', () => {
        const onRequestOffer = vi.fn();

        renderPrompt({
            hostKey: { ...UNKNOWN_HOST_KEY, isProxied: true },
            onRequestOffer,
            onTrust: vi.fn(),
        });

        expect(screen.getByText(HOST_KEY_PROXIED_NOTICE)).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).not.toBeInTheDocument();
        // ssh-keyscan cannot traverse a jump host, so scanning is not even attempted.
        expect(onRequestOffer).not.toHaveBeenCalled();
    });

    it('names both the alias and the resolved host when they differ', () => {
        renderPrompt({
            hostKey: { ...UNKNOWN_HOST_KEY, host: 'ssh.github.com', port: 443, alias: 'lab' },
            onRequestOffer: vi.fn().mockResolvedValue(offerResponse()),
            onTrust: vi.fn(),
        });

        // Showing only one of the two leaves the user guessing which machine is meant.
        expect(screen.getByText('lab → ssh.github.com (port 443)')).toBeInTheDocument();
    });

    it('renders read-only when no trust callback is supplied', async () => {
        renderPrompt({
            hostKey: UNKNOWN_HOST_KEY,
            onRequestOffer: vi.fn().mockResolvedValue(offerResponse()),
        });

        await waitFor(() => expect(screen.getByText(ED25519_FINGERPRINT)).toBeInTheDocument());
        expect(screen.queryByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).not.toBeInTheDocument();
    });
});

describe('HostKeyTrustPrompt for a changed host key', () => {
    it('warns and never offers to trust the new key', () => {
        const onRequestOffer = vi.fn();

        renderPrompt({ hostKey: CHANGED_HOST_KEY, onRequestOffer, onTrust: vi.fn() });

        expect(screen.getByText(HOST_KEY_CHANGED_TITLE)).toBeInTheDocument();
        expect(screen.queryByText(HOST_KEY_TRUST_BUTTON_LABEL)).not.toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).not.toBeInTheDocument();
        // No fingerprint is fetched either: there is nothing here for the user to accept.
        expect(onRequestOffer).not.toHaveBeenCalled();
    });

    it('points at the entry to remove and the command to remove it with', () => {
        renderPrompt({ hostKey: CHANGED_HOST_KEY, onTrust: vi.fn() });

        expect(screen.getByText('/home/u/.ssh/known_hosts:3')).toBeInTheDocument();
        expect(screen.getByText("ssh-keygen -R '[aus-wh-05]:45985'")).toBeInTheDocument();
    });

    it('uses the bare host in the removal command on the default port', () => {
        renderPrompt({ hostKey: { ...CHANGED_HOST_KEY, port: 22 }, onTrust: vi.fn() });

        // The bracket form is only how a non-default port is keyed.
        expect(screen.getByText('ssh-keygen -R aus-wh-05')).toBeInTheDocument();
    });

    it('copies the removal command and confirms next to the button', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

        renderPrompt({ hostKey: CHANGED_HOST_KEY, onTrust: vi.fn() });

        fireEvent.click(screen.getByTestId(TEST_IDS.HOST_KEY_COPY_COMMAND));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith("ssh-keygen -R '[aus-wh-05]:45985'"));
        await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());

        vi.unstubAllGlobals();
    });

    it('leaves the command on screen when the clipboard is unavailable', async () => {
        vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

        renderPrompt({ hostKey: CHANGED_HOST_KEY, onTrust: vi.fn() });

        fireEvent.click(screen.getByTestId(TEST_IDS.HOST_KEY_COPY_COMMAND));

        // No throw, and the command is still selectable by hand.
        await waitFor(() => expect(screen.getByText("ssh-keygen -R '[aus-wh-05]:45985'")).toBeInTheDocument());
        expect(screen.queryByText('Copied')).not.toBeInTheDocument();

        vi.unstubAllGlobals();
    });
});

describe('HostKeyTrustPrompt under SERVER_MODE', () => {
    it('renders nothing, matching the local-only endpoints', () => {
        SERVER_CONFIG.SERVER_MODE = true;
        const onRequestOffer = vi.fn();

        renderPrompt({ hostKey: UNKNOWN_HOST_KEY, onRequestOffer, onTrust: vi.fn() });

        expect(screen.queryByTestId(TEST_IDS.HOST_KEY_PROMPT)).not.toBeInTheDocument();
        expect(onRequestOffer).not.toHaveBeenCalled();
    });

    it('hides the changed-key warning too', () => {
        SERVER_CONFIG.SERVER_MODE = true;

        renderPrompt({ hostKey: CHANGED_HOST_KEY, onTrust: vi.fn() });

        expect(screen.queryByTestId(TEST_IDS.HOST_KEY_PROMPT)).not.toBeInTheDocument();
    });
});
