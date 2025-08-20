// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/* eslint-disable no-console */
import React, { ReactNode, createContext, useEffect } from 'react';
import { Socket, io } from 'socket.io-client';
import { useAtom } from 'jotai';
import { getOrCreateInstanceId } from './axiosInstance';
import { fileTransferProgressAtom } from '../store/app';
import { FileProgress, FileStatus } from '../model/APIData';
import getServerConfig from '../functions/getServerConfig';

type SocketContextType = Socket | null;

const { BASE_PATH } = getServerConfig();

const socket = io(`${BASE_PATH}?instanceId=${getOrCreateInstanceId()}`);

const SocketContext = createContext<SocketContextType>(null);

interface SocketProviderProps {
    children: ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
    const [_, setFileTransferProgress] = useAtom(fileTransferProgressAtom);
    const instanceId = getOrCreateInstanceId();

    useEffect(() => {
        socket.on('connect', () => {
            setFileTransferProgress((previous: FileProgress) => ({ ...previous, status: FileStatus.INACTIVE }));

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
            if (data.instanceId === instanceId) {
                setFileTransferProgress({
                    currentFileName: data.current_file_name,
                    numberOfFiles: data.number_of_files,
                    percentOfCurrent: data.percent_of_current,
                    finishedFiles: data.finished_files,
                    status: data.status,
                });
            }
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
        };
    }, [instanceId, setFileTransferProgress]);

    return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
};
