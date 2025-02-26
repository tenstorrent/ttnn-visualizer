// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

/* eslint-disable no-console */
import React, { ReactNode, createContext, useEffect } from 'react';
import { Socket, io } from 'socket.io-client';
import { useAtom } from 'jotai';
import { getOrCreateTabId } from './axiosInstance';
import { fileTransferProgressAtom } from '../store/app';
import { FileProgress, FileStatus } from '../model/APIData';

// Define the type for the socket
export type SocketContextType = Socket | null;

// Initialize the socket connection (replace with your backend URL)
const socket = io(`http://localhost:8000?tabId=${getOrCreateTabId()}`);

// Create the SocketContext with a default value of `null`
const SocketContext = createContext<SocketContextType>(null);

// TypeScript interface for the provider props
interface SocketProviderProps {
    children: ReactNode; // React children components
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
    const [_, setFileTransferProgress] = useAtom(fileTransferProgressAtom);
    const tabId = getOrCreateTabId();

    useEffect(() => {
        // Debugging: Listen for connection and disconnection events
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

        // Handle file transfer progress from the socket
        socket.on('fileTransferProgress', (data) => {
            if (data.tab_id === tabId) {
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
            // Cleanup socket listeners on unmount
            // socket.offAny();
            socket.off('connect');
            socket.off('disconnect');
            socket.off('connect_error');
            socket.off('reconnect');
        };
    }, [tabId, setFileTransferProgress]);

    return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
};
