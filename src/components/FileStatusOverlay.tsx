// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { useAtom } from 'jotai';
import { useContext, useEffect, useState } from 'react';
import Overlay from './Overlay';
import ProgressBar from './ProgressBar';
import 'styles/components/FileStatusOverlay.scss';
import { SocketContext, SocketContextType } from '../libs/SocketProvider';
import { getOrCreateTabId } from '../libs/axiosInstance';
import { FileProgress, FileStatus } from '../model/APIData';
import { fileTransferProgressAtom } from '../store/app';

interface FileStatusOverlayProps {
    canEscapeKeyClose?: boolean;
}

function FileStatusOverlay({ canEscapeKeyClose = false }: FileStatusOverlayProps) {
    const [fileTransferProgress, setFileTransferProgress] = useAtom(fileTransferProgressAtom);
    const [tabId] = useState(getOrCreateTabId());
    const socket = useContext<SocketContextType>(SocketContext);

    const formatPercentage = (percentage: number) => percentage.toFixed(2).padStart(5, '0');

    useEffect(() => {
        if (!socket) {
            return;
        }

        socket.on('connect', () => {
            // Reset the progress when the socket reconnects (possible HMR case)
            setFileTransferProgress({
                currentFileName: '',
                numberOfFiles: 0,
                percentOfCurrent: 0,
                finishedFiles: 0,
                status: FileStatus.FINISHED,
            });
        });

        // Listen for file transfer progress messages
        socket.on('fileTransferProgress', (data: FileProgress & { tab_id: string }) => {
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

        // Clean up the WebSocket connection on component unmount
        // eslint-disable-next-line consistent-return
        return () => {
            socket.off('fileTransferProgress');
        };
    }, [socket, setFileTransferProgress, tabId]);
    return (
        <Overlay
            isOpen={[FileStatus.COMPRESSING, FileStatus.DOWNLOADING, FileStatus.STARTED].includes(
                fileTransferProgress.status,
            )}
            hideCloseButton
            canEscapeKeyClose={canEscapeKeyClose}
            canOutsideClickClose={false}
        >
            <div className='overlay'>
                <h2>File Transfer Progress</h2>
                <p>Current File: {fileTransferProgress.currentFileName}</p>
                <p>
                    Files Transferred: {fileTransferProgress.finishedFiles}/{fileTransferProgress.numberOfFiles}
                </p>
                <p>Current File Progress: {formatPercentage(fileTransferProgress.percentOfCurrent)}%</p>
                <p>Status: {fileTransferProgress.status}</p>
            </div>

            <ProgressBar progress={fileTransferProgress.percentOfCurrent / 100} />
        </Overlay>
    );
}

export default FileStatusOverlay;
