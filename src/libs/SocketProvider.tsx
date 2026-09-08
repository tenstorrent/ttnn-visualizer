// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/* eslint-disable no-console */
import { ReactNode, createContext, useEffect } from 'react';
import { Socket, io } from 'socket.io-client';
import { getOrCreateInstanceId } from './axiosInstance';
import { FileTransferSource } from '../definitions/FileTransferSource';
import { clearStaleRemoteSyncOnReconnect, setFileTransferProgressForSource } from '../store/app';
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
            // Reconnect-triggered only (not a wall-clock timer). If the backend
            // dies and socket.io never reconnects, the axios timeout in
            // syncRemoteFolder is the backstop — not infinite, but until then
            // the overlay can linger (#1757).
            clearStaleRemoteSyncOnReconnect();

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
