// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteConnectionDialog from '../src/components/report-selection/RemoteConnectionDialog';
import { ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { RemoteConnection } from '../src/definitions/RemoteConnection';

const MULTIHOST_CHECKBOX_LABEL = 'Search per-rank subdirectories';

const getServerConfigMock = vi.hoisted(() =>
    vi.fn(() => ({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '/mem',
        SSH_DEFAULT_PERFORMANCE_PATH: '/perf',
        USERNAME: 'bob',
    })),
);

const testConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        testConnection: testConnectionMock,
    }),
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    getServerConfigMock.mockClear();
    getServerConfigMock.mockReturnValue({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '/mem',
        SSH_DEFAULT_PERFORMANCE_PATH: '/perf',
        USERNAME: 'bob',
    });
    testConnectionMock.mockReset();
    testConnectionMock.mockResolvedValue([{ status: ConnectionTestStates.OK, message: 'Connection OK' }]);
});

describe('RemoteConnectionDialog defaults', () => {
    it('seeds add-connection fields from getServerConfig', () => {
        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByLabelText('SSH Port')).toHaveValue('2222');
        expect(screen.getByLabelText('Memory report folder path')).toHaveValue('/mem');
        expect(screen.getByLabelText('Performance report folder path')).toHaveValue('/perf');
        expect(screen.getByLabelText('Username')).toHaveValue('bob');
    });

    it('treats a missing performancePath on edit as an empty controlled input', () => {
        const remoteConnection = {
            name: 'c',
            host: 'h',
            port: 22,
            username: 'u',
            profilerPath: '/p',
        } as RemoteConnection;

        render(
            <RemoteConnectionDialog
                open
                remoteConnection={remoteConnection}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByLabelText('Performance report folder path')).toHaveValue('');
    });
});

describe('RemoteConnectionDialog multihost performance flag', () => {
    it('defaults to unchecked for a new connection', () => {
        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByLabelText(MULTIHOST_CHECKBOX_LABEL)).not.toBeChecked();
    });

    it('reflects the saved flag when editing a connection', () => {
        const remoteConnection: RemoteConnection = {
            name: 'c',
            host: 'h',
            port: 22,
            username: 'u',
            profilerPath: '/p',
            performancePath: '/remote/generated/profiler/ttrun',
            multihostPerformance: true,
        };

        render(
            <RemoteConnectionDialog
                open
                remoteConnection={remoteConnection}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByLabelText(MULTIHOST_CHECKBOX_LABEL)).toBeChecked();
    });

    it('sends the flag with the connection test and the saved connection', async () => {
        const onAddConnection = vi.fn();

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={onAddConnection}
            />,
        );

        fireEvent.click(screen.getByLabelText(MULTIHOST_CHECKBOX_LABEL));
        fireEvent.click(screen.getByRole('button', { name: 'Run tests' }));

        await waitFor(() =>
            expect(testConnectionMock).toHaveBeenCalledWith(expect.objectContaining({ multihostPerformance: true })),
        );

        const saveButton = screen.getByRole('button', { name: 'Add connection' });
        await waitFor(() => expect(saveButton).toBeEnabled());
        fireEvent.click(saveButton);

        expect(onAddConnection).toHaveBeenCalledWith(expect.objectContaining({ multihostPerformance: true }));
    });
});
