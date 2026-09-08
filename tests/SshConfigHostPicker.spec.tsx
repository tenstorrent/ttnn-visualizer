// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SshConfigHostPicker from '../src/components/report-selection/SshConfigHostPicker';
import {
    SSH_CONFIG_HOST_ADD_CONNECTION_LABEL,
    SSH_CONFIG_HOST_ADD_SERVER_LABEL,
    SSH_CONFIG_HOST_CUSTOM,
    SSH_CONFIG_HOST_GROUP_LABEL,
    SSH_CONFIG_HOST_PLACEHOLDER_CLASS,
    SSH_CONFIG_HOST_SUBLABEL,
    SSH_CONFIG_HOST_UNSELECTED,
    SSH_CONFIG_HOST_UNSELECTED_LABEL,
} from '../src/definitions/SshConfigHostPicker';
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
    handlers?: {
        onSelectHost?: () => void;
        onSelectCustom?: () => void;
        enabled?: boolean;
        addNewLabel?: string;
    },
) =>
    render(
        <SshConfigHostPicker
            value={value}
            addNewLabel={handlers?.addNewLabel ?? SSH_CONFIG_HOST_ADD_CONNECTION_LABEL}
            enabled={handlers?.enabled}
            onSelectCustom={handlers?.onSelectCustom ?? vi.fn()}
            onSelectHost={handlers?.onSelectHost ?? vi.fn()}
        />,
    );

const getPicker = () => screen.getByLabelText(SSH_CONFIG_HOST_SUBLABEL) as HTMLSelectElement;

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

    it('groups the config aliases apart from the option that adds a new target', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([MOCK_SSH_CONFIG_HOST]));

        renderPicker(SSH_CONFIG_HOST_UNSELECTED);

        const alias = screen.getByRole('option', { name: 'work-gpu — gpu.example.com' });
        expect(alias.closest('optgroup')).toHaveAttribute('label', SSH_CONFIG_HOST_GROUP_LABEL);

        // The other two are the dropdown's own options, not anything ~/.ssh/config offered.
        expect(
            screen.getByRole('option', { name: SSH_CONFIG_HOST_ADD_CONNECTION_LABEL }).closest('optgroup'),
        ).toBeNull();
        expect(screen.getByRole('option', { name: SSH_CONFIG_HOST_UNSELECTED_LABEL }).closest('optgroup')).toBeNull();
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

    it.each([
        ['a remote connection', SSH_CONFIG_HOST_ADD_CONNECTION_LABEL, SSH_CONFIG_HOST_ADD_SERVER_LABEL],
        ['an MLIR server', SSH_CONFIG_HOST_ADD_SERVER_LABEL, SSH_CONFIG_HOST_ADD_CONNECTION_LABEL],
    ])('names what the surrounding dialog adds when it is %s', (_dialog, addNewLabel, otherLabel) => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));

        // One shared label would read as the wrong noun in whichever dialog it wasn't written for.
        renderPicker(SSH_CONFIG_HOST_UNSELECTED, { addNewLabel });

        expect(screen.getByRole('option', { name: addNewLabel })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: otherLabel })).not.toBeInTheDocument();
    });

    it('calls onSelectCustom when the add-new option is chosen', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));
        const onSelectHost = vi.fn();
        const onSelectCustom = vi.fn();

        renderPicker('work-gpu', { onSelectHost, onSelectCustom });
        fireEvent.change(getPicker(), { target: { value: SSH_CONFIG_HOST_CUSTOM } });

        expect(onSelectCustom).toHaveBeenCalledOnce();
        expect(onSelectHost).not.toHaveBeenCalled();
    });

    it('prefills from a host whose alias reads like the custom-host sentinel', () => {
        const host = { host: 'custom', user: 'alice' };
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([host]));
        const onSelectHost = vi.fn();
        const onSelectCustom = vi.fn();

        renderPicker(SSH_CONFIG_HOST_CUSTOM, { onSelectHost, onSelectCustom });
        fireEvent.change(getPicker(), { target: { value: 'custom' } });

        expect(onSelectHost).toHaveBeenCalledWith(host);
        expect(onSelectCustom).not.toHaveBeenCalled();
    });

    it('shows the add-new option when the current host is not a config alias', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));

        renderPicker('hand-typed-host');

        expect(getPicker().value).toBe(SSH_CONFIG_HOST_CUSTOM);
    });

    it('shows a placeholder, which is a prompt rather than a choice, while nothing has been chosen', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));

        renderPicker(SSH_CONFIG_HOST_UNSELECTED);

        expect(getPicker().value).toBe(SSH_CONFIG_HOST_UNSELECTED);
        expect(screen.getByRole('option', { name: SSH_CONFIG_HOST_UNSELECTED_LABEL })).toBeDisabled();
        // Muted, so an unanswered picker doesn't read as a value the user settled on.
        expect(getPicker().parentElement).toHaveClass(SSH_CONFIG_HOST_PLACEHOLDER_CLASS);
    });

    it('drops the placeholder once a choice is made', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));

        // Choosing it again would mean unchoosing, which nothing downstream can act on.
        renderPicker(SSH_CONFIG_HOST_CUSTOM);

        expect(screen.queryByRole('option', { name: SSH_CONFIG_HOST_UNSELECTED_LABEL })).not.toBeInTheDocument();
        expect(getPicker().parentElement).not.toHaveClass(SSH_CONFIG_HOST_PLACEHOLDER_CLASS);
    });

    it('shows the selected alias when it matches a config host', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));

        renderPicker('work-gpu');

        expect(getPicker().value).toBe('work-gpu');
    });
});
