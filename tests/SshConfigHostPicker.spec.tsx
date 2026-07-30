// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SshConfigHostPicker from '../src/components/report-selection/SshConfigHostPicker';
import { SSH_CONFIG_HOST_CUSTOM } from '../src/definitions/RemoteConnection';
import { SshConfigHost, SshConfigHostsResponse } from '../src/model/SshConfigHost';

const getServerConfigMock = vi.hoisted(() =>
    vi.fn(() => ({
        SERVER_MODE: false,
    })),
);

const useSshConfigHostsMock = vi.hoisted(() =>
    vi.fn(
        (): {
            data: SshConfigHostsResponse | undefined;
            isError: boolean;
            isPending: boolean;
        } => ({
            data: { configExists: false, hosts: [] },
            isError: false,
            isPending: false,
        }),
    ),
);

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/hooks/useSshConfigHosts', () => ({
    default: useSshConfigHostsMock,
    getSshConfigHostLabel: (host: SshConfigHost) => (host.hostName ? `${host.host} — ${host.hostName}` : host.host),
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    getServerConfigMock.mockClear();
    getServerConfigMock.mockReturnValue({ SERVER_MODE: false });
    useSshConfigHostsMock.mockClear();
    useSshConfigHostsMock.mockReturnValue({
        data: { configExists: false, hosts: [] },
        isError: false,
        isPending: false,
    });
});

describe('SshConfigHostPicker', () => {
    it('renders null when ~/.ssh/config does not exist', () => {
        const { container } = render(
            <SshConfigHostPicker
                value={SSH_CONFIG_HOST_CUSTOM}
                onSelectCustom={vi.fn()}
                onSelectHost={vi.fn()}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders null when the config exists but has no concrete hosts', () => {
        useSshConfigHostsMock.mockReturnValue({
            data: { configExists: true, hosts: [] },
            isError: false,
            isPending: false,
        });

        const { container } = render(
            <SshConfigHostPicker
                value={SSH_CONFIG_HOST_CUSTOM}
                onSelectCustom={vi.fn()}
                onSelectHost={vi.fn()}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders null while the config check is pending', () => {
        useSshConfigHostsMock.mockReturnValue({
            data: undefined,
            isError: false,
            isPending: true,
        });

        const { container } = render(
            <SshConfigHostPicker
                value={SSH_CONFIG_HOST_CUSTOM}
                onSelectCustom={vi.fn()}
                onSelectHost={vi.fn()}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders null on error', () => {
        useSshConfigHostsMock.mockReturnValue({
            data: { configExists: true, hosts: [{ host: 'x' }] },
            isError: true,
            isPending: false,
        });

        const { container } = render(
            <SshConfigHostPicker
                value={SSH_CONFIG_HOST_CUSTOM}
                onSelectCustom={vi.fn()}
                onSelectHost={vi.fn()}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders null under SERVER_MODE even when hosts are available', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });
        useSshConfigHostsMock.mockReturnValue({
            data: { configExists: true, hosts: [{ host: 'work-gpu' }] },
            isError: false,
            isPending: false,
        });

        const { container } = render(
            <SshConfigHostPicker
                value={SSH_CONFIG_HOST_CUSTOM}
                onSelectCustom={vi.fn()}
                onSelectHost={vi.fn()}
            />,
        );

        expect(container).toBeEmptyDOMElement();
        expect(useSshConfigHostsMock).toHaveBeenCalledWith(false);
    });

    it('calls onSelectHost when a config host is chosen', () => {
        const host = { host: 'work-gpu', user: 'alice', port: 2222 };
        useSshConfigHostsMock.mockReturnValue({
            data: { configExists: true, hosts: [host] },
            isError: false,
            isPending: false,
        });
        const onSelectHost = vi.fn();
        const onSelectCustom = vi.fn();

        render(
            <SshConfigHostPicker
                value={SSH_CONFIG_HOST_CUSTOM}
                onSelectCustom={onSelectCustom}
                onSelectHost={onSelectHost}
            />,
        );

        fireEvent.change(screen.getByLabelText('SSH config host'), { target: { value: 'work-gpu' } });

        expect(onSelectHost).toHaveBeenCalledWith(host);
        expect(onSelectCustom).not.toHaveBeenCalled();
    });

    it('calls onSelectCustom when Custom is chosen', () => {
        useSshConfigHostsMock.mockReturnValue({
            data: { configExists: true, hosts: [{ host: 'work-gpu' }] },
            isError: false,
            isPending: false,
        });
        const onSelectHost = vi.fn();
        const onSelectCustom = vi.fn();

        render(
            <SshConfigHostPicker
                value='work-gpu'
                onSelectCustom={onSelectCustom}
                onSelectHost={onSelectHost}
            />,
        );

        fireEvent.change(screen.getByLabelText('SSH config host'), {
            target: { value: SSH_CONFIG_HOST_CUSTOM },
        });

        expect(onSelectCustom).toHaveBeenCalledOnce();
        expect(onSelectHost).not.toHaveBeenCalled();
    });
});
