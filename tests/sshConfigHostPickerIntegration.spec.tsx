// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The other picker specs replace useSshConfigHosts with a fixture, so nothing there
 * would notice the hook and the picker drifting apart. This one wires the real hook to
 * the real component over a mocked axios layer.
 */

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SshConfigHostPicker from '../src/components/report-selection/SshConfigHostPicker';
import Endpoints from '../src/definitions/Endpoints';
import {
    SSH_CONFIG_HOST_ADD_CONNECTION_LABEL,
    SSH_CONFIG_HOST_CUSTOM,
    SSH_CONFIG_HOST_LABEL,
} from '../src/definitions/SshConfigHostPicker';
import axiosInstance from '../src/libs/axiosInstance';

const getServerConfigMock = vi.hoisted(() => vi.fn(() => ({ SERVER_MODE: false })));

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/libs/axiosInstance', () => ({
    default: { get: vi.fn() },
}));

const mockedGet = vi.mocked(axiosInstance.get);

const WORK_GPU = { host: 'work-gpu', hostName: 'gpu.example.com', user: 'alice', port: 2222 };
const BARE = { host: 'bare-host' };

const renderPicker = (onSelectHost = vi.fn()) => {
    const client = new QueryClient();
    const view = render(
        <QueryClientProvider client={client}>
            <SshConfigHostPicker
                value={SSH_CONFIG_HOST_CUSTOM}
                addNewLabel={SSH_CONFIG_HOST_ADD_CONNECTION_LABEL}
                onSelectCustom={vi.fn()}
                onSelectHost={onSelectHost}
            />
        </QueryClientProvider>,
    );

    return { ...view, onSelectHost };
};

beforeEach(() => {
    getServerConfigMock.mockReturnValue({ SERVER_MODE: false });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('SshConfigHostPicker over the real useSshConfigHosts hook', () => {
    it('renders an option per host from the endpoint payload', async () => {
        mockedGet.mockResolvedValue({ data: { configExists: true, hosts: [WORK_GPU, BARE] } });

        renderPicker();

        await waitFor(() => expect(screen.getByLabelText(SSH_CONFIG_HOST_LABEL)).toBeInTheDocument());
        expect(mockedGet).toHaveBeenCalledWith(Endpoints.REMOTE_SSH_CONFIG_HOSTS);
        expect(screen.getByRole('option', { name: 'work-gpu — gpu.example.com' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'bare-host' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: SSH_CONFIG_HOST_ADD_CONNECTION_LABEL })).toBeInTheDocument();
    });

    it('hands the selected host straight through from the payload', async () => {
        mockedGet.mockResolvedValue({ data: { configExists: true, hosts: [WORK_GPU] } });

        const { onSelectHost } = renderPicker();

        await waitFor(() => expect(screen.getByLabelText(SSH_CONFIG_HOST_LABEL)).toBeInTheDocument());
        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'work-gpu' } });

        expect(onSelectHost).toHaveBeenCalledWith(WORK_GPU);
    });

    it('stays hidden while the request is in flight', () => {
        mockedGet.mockReturnValue(new Promise(() => {}));

        const { container } = renderPicker();

        expect(container).toBeEmptyDOMElement();
    });

    it('stays hidden when the endpoint fails', async () => {
        mockedGet.mockRejectedValue(new Error('boom'));

        const { container } = renderPicker();

        await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
        expect(container).toBeEmptyDOMElement();
    });

    it('stays hidden, and never calls the local-only endpoint, under SERVER_MODE', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });
        mockedGet.mockResolvedValue({ data: { configExists: true, hosts: [WORK_GPU] } });

        const { container } = renderPicker();

        expect(container).toBeEmptyDOMElement();
        expect(mockedGet).not.toHaveBeenCalled();
    });
});
