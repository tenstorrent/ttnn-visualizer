// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from 'react';
import Overlay from './Overlay';
import ProgressBar from './ProgressBar';
import 'styles/components/FileStatusOverlay.scss';
import { FileProgress } from '../model/APIData';

interface FileTransferOverlayProps {
    progress: FileProgress;
    open: boolean;
}

const FileStatusOverlay: React.FC<FileTransferOverlayProps> = ({ progress, open }) => {
    const formatPercentage = (percentage: number) => percentage.toFixed(2).padStart(5, '0');

    const { status, currentFileName, finishedFiles, numberOfFiles, percentOfCurrent } = progress;

    return (
        <Overlay
            isOpen={open}
            hideCloseButton
            canEscapeKeyClose={false}
            canOutsideClickClose={false}
        >
            <div className='overlay'>
                <h2>File Transfer Progress</h2>
                <p>Current File: {currentFileName}</p>
                <p>
                    Files Transferred: {finishedFiles}/{numberOfFiles}
                </p>
                <p>Current File Progress: {formatPercentage(percentOfCurrent)}%</p>
                <p>Status: {status}</p>
            </div>

            <ProgressBar progress={percentOfCurrent / 100} />
        </Overlay>
    );
};

export default FileStatusOverlay;
