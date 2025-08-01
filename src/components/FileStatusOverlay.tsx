// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import { useAtom } from 'jotai';
import Overlay from './Overlay';
import ProgressBar from './ProgressBar';
import 'styles/components/FileStatusOverlay.scss';
import { fileTransferProgressAtom } from '../store/app';
import { FileStatus } from '../model/APIData';

const FileStatusOverlay: React.FC = () => {
    const formatPercentage = (percentage: number) => percentage.toFixed(2).padStart(5, '0');
    const [progress] = useAtom(fileTransferProgressAtom);
    const { currentFileName, finishedFiles, numberOfFiles, percentOfCurrent, status } = progress;
    return (
        <Overlay
            isOpen={[FileStatus.STARTED, FileStatus.COMPRESSING, FileStatus.DOWNLOADING, FileStatus.UPLOADING].includes(
                status,
            )}
            hideCloseButton
            canEscapeKeyClose={false}
            canOutsideClickClose={false}
        >
            <div className='overlay'>
                <h2>File Transfer Progress</h2>
                {currentFileName && <p>Current File: {currentFileName}</p>}
                {numberOfFiles && (
                    <p>
                        Files Transferred: {finishedFiles}/{numberOfFiles}
                    </p>
                )}
                <p>Current File Progress: {formatPercentage(percentOfCurrent)}%</p>
                {status && <p>Status: {status.valueOf()}</p>}
            </div>

            <ProgressBar progress={percentOfCurrent / 100} />
        </Overlay>
    );
};

export default FileStatusOverlay;
