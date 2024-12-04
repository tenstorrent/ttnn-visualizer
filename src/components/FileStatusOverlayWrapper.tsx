// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { useContext, useEffect, useState } from 'react';
import { SocketContext, SocketContextType } from '../libs/SocketProvider';
import { FileProgress, FileStatus } from '../model/APIData';
import { getOrCreateTabId } from '../libs/axiosInstance';

interface FileTransferStatusWrapperProps {
    children: (fileProgress: FileProgress) => React.ReactNode;
}

const FileStatusWrapper: React.FC<FileTransferStatusWrapperProps> = ({ children }) => {
    const [fileTransferProgress, setFileTransferProgress] = useState<FileProgress>({
        currentFileName: '',
        numberOfFiles: 0,
        percentOfCurrent: 0,
        finishedFiles: 0,
        status: FileStatus.INACTIVE,
    });

    const [tabId] = useState(getOrCreateTabId());
    const socket = useContext<SocketContextType>(SocketContext);

    useEffect(() => {
        if (!socket) {
            return;
        }

        // Handle socket connection event
        socket.on('connect', () => {
            setFileTransferProgress({
                currentFileName: '',
                numberOfFiles: 0,
                percentOfCurrent: 0,
                finishedFiles: 0,
                status: FileStatus.INACTIVE,
            });
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

        // Cleanup socket listeners on unmount
        // eslint-disable-next-line consistent-return
        return () => {
            socket.off('fileTransferProgress');
        };
    }, [socket, tabId]);

    // Call the children render prop with the file transfer progress
    return <>{children(fileTransferProgress)}</>;
};

export default FileStatusWrapper;
