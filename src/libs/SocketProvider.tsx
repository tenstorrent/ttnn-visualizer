/* eslint-disable no-console */
import React, { ReactNode, createContext, useEffect } from 'react';
import { Socket, io } from 'socket.io-client';
import { getOrCreateTabId } from './axiosInstance';

// Define the type for the socket
export type SocketContextType = Socket | null;

// Initialize the socket connection (replace with your backend URL)
const socket = io(`http://localhost:8000?tabId=${getOrCreateTabId()}`);

// Create the SocketContext with a default value of `null`
export const SocketContext = createContext<SocketContextType>(null);

// TypeScript interface for the provider props
interface SocketProviderProps {
    children: ReactNode; // React children components
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
    useEffect(() => {
        // Debugging: Listen for connection and disconnection events
        socket.on('connect', () => {
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
    }, []);

    return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
};
