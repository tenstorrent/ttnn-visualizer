/* eslint-disable no-console */
import React, { ReactNode, createContext, useEffect, useMemo } from 'react';
import { Socket, io } from 'socket.io-client';
import { getOrCreateTabId } from './axiosInstance';

// Define the type for the socket
export type SocketContextType = { socket: Socket | null };

// Create the SocketContext with a default value of `null`
export const SocketContext = createContext<SocketContextType>({ socket: null });

// TypeScript interface for the provider props
interface SocketProviderProps {
    children: ReactNode; // React children components
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
    // Initialize the socket connection in useMemo to ensure it's created only once
    const socket = useMemo(() => {
        const newSocket = io(`http://127.0.0.1:8000?tabId=${getOrCreateTabId()}`);
        newSocket.on('connect_error', (error: Error) => {
            console.error('Connection error:', error.message);
        });
        newSocket.on('connect', () => {
            console.log(`Socket connected with ID: ${socket.id}`);
            socket.emit('ping', { message: 'Connected' });
        });

        newSocket.on('disconnect', (reason: string) => {
            console.log(`Socket disconnected: ${reason}`);
        });

        newSocket.on('connect_error', (error: Error) => {
            console.error(`Socket connection error: ${error.message}`);
        });

        newSocket.on('reconnect', (attemptNumber: number) => {
            console.log(`Socket reconnected after ${attemptNumber} attempts`);
        });
        return newSocket;
    }, []);

    useEffect(() => {
        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('connect_error');
            socket.off('reconnect');
            socket.disconnect(); // Optionally disconnect on unmount
        };
    }, [socket]);

    // Memoize the context value to prevent re-creating the object on every render
    const contextValue = useMemo(() => ({ socket }), [socket]);

    return <SocketContext.Provider value={contextValue}>{children}</SocketContext.Provider>;
};
