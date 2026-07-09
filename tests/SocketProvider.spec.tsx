// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTransferSource } from '../src/definitions/FileTransferSource';
import { FileStatus } from '../src/model/APIData';

const socketTestContext = vi.hoisted(() => {
    const TEST_INSTANCE_ID = 'test-instance-id';
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

    const socket = {
        id: 'mock-socket-id',
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[event] = handlers[event] ?? [];
            handlers[event].push(handler);
        }),
        off: vi.fn((event: string) => {
            delete handlers[event];
        }),
    };

    const emit = (event: string, ...args: unknown[]) => {
        handlers[event]?.forEach((handler) => {
            handler(...args);
        });
    };

    return { TEST_INSTANCE_ID, socket, emit, handlers };
});

const registryMocks = vi.hoisted(() => ({
    clearFileTransferProgressForSourceIfInactive: vi.fn(),
    setFileTransferProgressForSource: vi.fn(),
}));

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => socketTestContext.socket),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: vi.fn(() => ({ BASE_PATH: '/api' })),
}));

vi.mock('../src/libs/axiosInstance', () => ({
    getOrCreateInstanceId: vi.fn(() => socketTestContext.TEST_INSTANCE_ID),
}));

vi.mock('../src/functions/fileTransferRegistry', async () => {
    const actual = await vi.importActual<typeof import('../src/functions/fileTransferRegistry')>(
        '../src/functions/fileTransferRegistry',
    );
    return {
        ...actual,
        clearFileTransferProgressForSourceIfInactive: (
            ...args: Parameters<typeof actual.clearFileTransferProgressForSourceIfInactive>
        ) => registryMocks.clearFileTransferProgressForSourceIfInactive(...args),
        setFileTransferProgressForSource: (...args: Parameters<typeof actual.setFileTransferProgressForSource>) =>
            registryMocks.setFileTransferProgressForSource(...args),
    };
});

let SocketProvider: typeof import('../src/libs/SocketProvider').SocketProvider;

async function mountSocketProvider() {
    render(
        <SocketProvider>
            <div />
        </SocketProvider>,
    );

    await waitFor(() => {
        expect(socketTestContext.handlers.connect).toBeDefined();
    });
}

async function mountSocketProviderWithProgressHandler() {
    render(
        <SocketProvider>
            <div />
        </SocketProvider>,
    );

    await waitFor(() => {
        expect(socketTestContext.handlers.fileTransferProgress).toBeDefined();
    });
}

beforeAll(async () => {
    ({ SocketProvider } = await import('../src/libs/SocketProvider'));
});

beforeEach(() => {
    registryMocks.clearFileTransferProgressForSourceIfInactive.mockReset();
    registryMocks.setFileTransferProgressForSource.mockReset();
    Object.keys(socketTestContext.handlers).forEach((event) => {
        delete socketTestContext.handlers[event];
    });
});

afterEach(() => {
    cleanup();
});

describe('SocketProvider file transfer progress', () => {
    it('clears inactive REMOTE_SYNC on connect', async () => {
        await mountSocketProvider();
        socketTestContext.emit('connect');

        expect(registryMocks.clearFileTransferProgressForSourceIfInactive).toHaveBeenCalledWith(
            FileTransferSource.REMOTE_SYNC,
        );
    });

    it('writes REMOTE_SYNC progress only when instance_id matches', async () => {
        await mountSocketProviderWithProgressHandler();

        socketTestContext.emit('fileTransferProgress', {
            instance_id: 'other-instance',
            current_file_name: 'ignored.sqlite',
            number_of_files: 9,
            percent_of_current: 50,
            finished_files: 4,
            status: FileStatus.DOWNLOADING,
        });

        expect(registryMocks.setFileTransferProgressForSource).not.toHaveBeenCalled();

        socketTestContext.emit('fileTransferProgress', {
            instance_id: socketTestContext.TEST_INSTANCE_ID,
            current_file_name: 'db.sqlite',
            number_of_files: 3,
            percent_of_current: 66,
            finished_files: 2,
            status: FileStatus.DOWNLOADING,
            bytes_transferred: 100,
            bytes_total: 200,
            current_file_size: 50,
        });

        expect(registryMocks.setFileTransferProgressForSource).toHaveBeenCalledWith(FileTransferSource.REMOTE_SYNC, {
            currentFileName: 'db.sqlite',
            numberOfFiles: 3,
            percentOfCurrent: 66,
            finishedFiles: 2,
            status: FileStatus.DOWNLOADING,
            bytesTransferred: 100,
            bytesTotal: 200,
            currentFileSize: 50,
        });
    });
});
