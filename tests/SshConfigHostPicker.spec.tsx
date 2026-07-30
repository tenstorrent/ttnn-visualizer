// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SshConfigHostPicker from '../src/components/report-selection/SshConfigHostPicker';
import { SSH_CONFIG_HOST_CUSTOM, SSH_CONFIG_HOST_LABEL } from '../src/definitions/SshConfigHostPicker';
import {
    MOCK_SSH_CONFIG_HOST,
    SshConfigHostsQueryResult,
    failedSshConfigResult,
    noSshConfigResult,
    pendingSshConfigResult,
    sshConfigHostsResult,
} from './helpers/sshConfigFixtures';

const getServerConfigMock = vi.hoisted(() =>
    vi.fn(() => ({
        SERVER_MODE: false,
    })),
);

const useSshConfigHostsMock = vi.hoisted(() => vi.fn<(enabled?: boolean) => SshConfigHostsQueryResult>());

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/hooks/useSshConfigHosts', () => ({
    default: useSshConfigHostsMock,
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    getServerConfigMock.mockClear();
    getServerConfigMock.mockReturnValue({ SERVER_MODE: false });
    useSshConfigHostsMock.mockClear();
    useSshConfigHostsMock.mockReturnValue(noSshConfigResult());
});

const renderPicker = (
    value: string,
    handlers?: { onSelectHost?: () => void; onSelectCustom?: () => void; enabled?: boolean },
) =>
    render(
        <SshConfigHostPicker
            value={value}
            enabled={handlers?.enabled}
            onSelectCustom={handlers?.onSelectCustom ?? vi.fn()}
            onSelectHost={handlers?.onSelectHost ?? vi.fn()}
        />,
    );

const getPicker = () => screen.getByLabelText(SSH_CONFIG_HOST_LABEL) as HTMLSelectElement;

describe('SshConfigHostPicker', () => {
    it('renders null when ~/.ssh/config does not exist', () => {
        const { container } = renderPicker(SSH_CONFIG_HOST_CUSTOM);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders null when the config exists but has no concrete hosts', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([]));

        const { container } = renderPicker(SSH_CONFIG_HOST_CUSTOM);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders null while the config check is pending', () => {
        useSshConfigHostsMock.mockReturnValue(pendingSshConfigResult());

        const { container } = renderPicker(SSH_CONFIG_HOST_CUSTOM);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders null on error', () => {
        useSshConfigHostsMock.mockReturnValue(failedSshConfigResult([{ host: 'x' }]));

        const { container } = renderPicker(SSH_CONFIG_HOST_CUSTOM);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders null under SERVER_MODE even when hosts are available', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));

        const { container } = renderPicker(SSH_CONFIG_HOST_CUSTOM);

        expect(container).toBeEmptyDOMElement();
        expect(useSshConfigHostsMock).toHaveBeenCalledWith(false);
    });

    it('fetches when mounted enabled', () => {
        renderPicker(SSH_CONFIG_HOST_CUSTOM);

        expect(useSshConfigHostsMock).toHaveBeenCalledWith(true);
    });

    it('skips fetching when the dialog disables it', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));

        renderPicker(SSH_CONFIG_HOST_CUSTOM, { enabled: false });

        expect(useSshConfigHostsMock).toHaveBeenCalledWith(false);
    });

    it('labels a host with its HostName', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([MOCK_SSH_CONFIG_HOST]));

        renderPicker(SSH_CONFIG_HOST_CUSTOM);

        expect(screen.getByRole('option', { name: 'work-gpu — gpu.example.com' })).toBeInTheDocument();
    });

    it('calls onSelectHost when a config host is chosen', () => {
        const host = { host: 'work-gpu', user: 'alice', port: 2222 };
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([host]));
        const onSelectHost = vi.fn();
        const onSelectCustom = vi.fn();

        renderPicker(SSH_CONFIG_HOST_CUSTOM, { onSelectHost, onSelectCustom });
        fireEvent.change(getPicker(), { target: { value: 'work-gpu' } });

        expect(onSelectHost).toHaveBeenCalledWith(host);
        expect(onSelectCustom).not.toHaveBeenCalled();
    });

    it('calls onSelectCustom when Custom is chosen', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));
        const onSelectHost = vi.fn();
        const onSelectCustom = vi.fn();

        renderPicker('work-gpu', { onSelectHost, onSelectCustom });
        fireEvent.change(getPicker(), { target: { value: SSH_CONFIG_HOST_CUSTOM } });

        expect(onSelectCustom).toHaveBeenCalledOnce();
        expect(onSelectHost).not.toHaveBeenCalled();
    });

    it('prefills from a host whose alias reads like the Custom sentinel', () => {
        const host = { host: 'custom', user: 'alice' };
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([host]));
        const onSelectHost = vi.fn();
        const onSelectCustom = vi.fn();

        renderPicker(SSH_CONFIG_HOST_CUSTOM, { onSelectHost, onSelectCustom });
        fireEvent.change(getPicker(), { target: { value: 'custom' } });

        expect(onSelectHost).toHaveBeenCalledWith(host);
        expect(onSelectCustom).not.toHaveBeenCalled();
    });

    it('shows Custom when the current host is not a config alias', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));

        renderPicker('hand-typed-host');

        expect(getPicker().value).toBe(SSH_CONFIG_HOST_CUSTOM);
    });

    it('shows the selected alias when it matches a config host', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));

        renderPicker('work-gpu');

        expect(getPicker().value).toBe('work-gpu');
    });
});
