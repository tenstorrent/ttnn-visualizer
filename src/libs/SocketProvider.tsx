// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/* eslint-disable no-console */
import { ReactNode, createContext, useEffect } from 'react';
import { Socket, io } from 'socket.io-client';
import { getOrCreateInstanceId } from './axiosInstance';
import {
    clearFileTransferProgressForSourceIfInactive,
    setFileTransferProgressForSource,
} from '../functions/fileTransferRegistry';
import { FileTransferSource } from '../definitions/FileTransferSource';
import getServerConfig from '../functions/getServerConfig';

type SocketContextType = Socket | null;

const { BASE_PATH } = getServerConfig();

const socket = io(`${BASE_PATH}?instanceId=${getOrCreateInstanceId()}`);

const SocketContext = createContext<SocketContextType>(null);

interface SocketProviderProps {
    children: ReactNode;
}

export const SocketProvider = ({ children }: SocketProviderProps) => {
    const instanceId = getOrCreateInstanceId();

    useEffect(() => {
        socket.on('connect', () => {
            // Clear terminal / orphaned REMOTE_SYNC slots on reconnect. Fresh
            // active progress (updated within REMOTE_SYNC_PROGRESS_STALE_MS) is
            // kept so a mid-transfer socket drop does not wipe live work while
            // axios is still running. Slots left DOWNLOADING after backend death
            // without a FAILED event age out and are cleared (#1757).
            clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC);

            console.log(`Socket connected with ID: ${socket.id}`);
        });

        socket.on('disconnect', (reason: string) => {
            console.log(`Socket disconnected: ${reason}`);
        });

        socket.on('connect_error', (error: Error) => {
            console.error(`Socket connection error: ${error.message}`);
        });

        socket.on('reconnect', (attemptNumber: number) => {
            console.log(`Socket reconnected after ${attemptNumber} attempts`);
        });

        socket.on('fileTransferProgress', (data) => {
            // Require an explicit instance_id match so events bound for
            // another tab/connection never bleed into this one. Older
            // payloads without `instance_id` (treated as untargeted) are
            // ignored to stay safe under multi-tab use.
            if (data.instance_id !== instanceId) {
                return;
            }

            setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, {
                currentFileName: data.current_file_name,
                numberOfFiles: data.number_of_files,
                percentOfCurrent: data.percent_of_current,
                finishedFiles: data.finished_files,
                status: data.status,
                bytesTransferred: data.bytes_transferred,
                bytesTotal: data.bytes_total,
                currentFileSize: data.current_file_size,
            });
        });

        /* For debugging socket messages */
        // socket.onAny((eventName: string, data: any ) => {
        //     console.info(`Socket ${eventName}: ${JSON.stringify(data)}`);
        // })

        return () => {
            // socket.offAny();
            socket.off('connect');
            socket.off('disconnect');
            socket.off('connect_error');
            socket.off('reconnect');
            socket.off('fileTransferProgress');
        };
    }, [instanceId]);

    return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
};
