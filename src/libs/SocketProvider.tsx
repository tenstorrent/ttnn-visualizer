/* eslint-disable no-console */
import React, { ReactNode, createContext, useCallback, useEffect } from 'react';
import { Socket, io } from 'socket.io-client';
import { getOrCreateTabId } from './axiosInstance';

// Define the type for the socket
export type SocketContextType = { socket: Socket, uploadDirectory: any }

// Initialize the socket connection (replace with your backend URL)
const socket = io(`http://localhost:8000?tabId=${getOrCreateTabId()}`);

// Create the SocketContext with a default value of `null`
export const SocketContext = createContext<SocketContextType>(null as any);

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

        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('connect_error');
            socket.off('reconnect');
        };
    }, []);

    const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk

    const uploadDirectory = useCallback((files: File[]) => {
        if (files.length === 0) return;

        const topLevelDirectory = files[0].webkitRelativePath.split('/')[0];

        Array.from(files).forEach((file) => {
            let offset = 0;
            const fullRelativePath = file.webkitRelativePath; //
            const readChunk = () => {
                const reader = new FileReader();
                const slice = file.slice(offset, offset + CHUNK_SIZE);

                reader.onload = (event) => {
                    if (event.target?.result) {
                        // Emit the chunk to the server
                        socket.emit('upload-report', {
                            directory: topLevelDirectory,
                            fileName: fullRelativePath,
                            chunk: event.target.result,
                            isLastChunk: offset + CHUNK_SIZE >= file.size,
                        });

                        offset += CHUNK_SIZE;

                        // Continue reading the next chunk if not done
                        if (offset < file.size) {
                            readChunk();
                        }
                    }
                };

                reader.onerror = (error) => {
                    console.error('Error reading file chunk:', error);
                };

                reader.readAsArrayBuffer(slice);
            };

            // Start reading the first chunk
            readChunk();
        });
    }, []);


    return (
        <SocketContext.Provider value={{ socket, uploadDirectory }}>
            {children}
        </SocketContext.Provider>
    );
};