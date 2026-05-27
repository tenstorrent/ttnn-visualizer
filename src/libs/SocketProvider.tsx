// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/* eslint-disable no-console */
import { ReactNode, createContext, useEffect } from 'react';
import { Socket, io } from 'socket.io-client';
import { useSetAtom } from 'jotai';
import { getOrCreateInstanceId } from './axiosInstance';
import { fileTransferProgressAtom, getInactiveFileTransferProgress } from '../store/app';
import { FileProgress } from '../model/APIData';
import { isActiveTransferStatus } from '../functions/getFileStatusLabel';
import getServerConfig from '../functions/getServerConfig';

type SocketContextType = Socket | null;

const { BASE_PATH } = getServerConfig();

const socket = io(`${BASE_PATH}?instanceId=${getOrCreateInstanceId()}`);

const SocketContext = createContext<SocketContextType>(null);

interface SocketProviderProps {
    children: ReactNode;
}

export const SocketProvider = ({ children }: SocketProviderProps) => {
    const setFileTransferProgress = useSetAtom(fileTransferProgressAtom);
    const instanceId = getOrCreateInstanceId();

    useEffect(() => {
        socket.on('connect', () => {
            // Only clear stale progress if the previous transfer is no longer
            // active. A reconnect mid-upload (axios still running on the same
            // tab) must not close the overlay or drop the live progress.
            setFileTransferProgress((previous: FileProgress) =>
                isActiveTransferStatus(previous.status) ? previous : getInactiveFileTransferProgress(),
            );

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

            setFileTransferProgress({
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
    }, [instanceId, setFileTransferProgress]);

    return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
};
