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
import { formatPercentage } from '../functions/math';

const FileStatusOverlay: React.FC = () => {
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
                <h2 className='heading'>File Transfer Progress</h2>
                {numberOfFiles && (
                    <p>
                        Files Transferred: {finishedFiles}/{numberOfFiles}
                    </p>
                )}
                {currentFileName && (
                    <p>
                        Current File: <u>{currentFileName}</u>
                    </p>
                )}
                {status && <p>Status: {status.valueOf()}</p>}
                <p>{formatPercentage(percentOfCurrent, 0)}</p>
            </div>

            <ProgressBar
                progress={percentOfCurrent / 100}
                ariaLabel='File transfer progress'
            />
        </Overlay>
    );
};

export default FileStatusOverlay;
