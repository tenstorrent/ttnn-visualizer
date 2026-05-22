// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import Overlay from './Overlay';
import ProgressBar from './ProgressBar';
import 'styles/components/FileStatusOverlay.scss';
import { fileTransferProgressAtom } from '../store/app';
import { FileStatus } from '../model/APIData';
import { formatMemorySize, formatPercentage } from '../functions/math';
import { getFileStatusLabel, shouldShowStatus } from '../functions/getFileStatusLabel';
import { getOverallFileTransferPercent } from '../functions/getOverallFileTransferPercent';

const ELAPSED_REFRESH_MS = 1000;

const formatElapsed = (totalSeconds: number): string => {
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

const FileStatusOverlay = () => {
    const [progress] = useAtom(fileTransferProgressAtom);
    const { currentFileName, finishedFiles, numberOfFiles, status, bytesTransferred, bytesTotal, currentFileSize } =
        progress;
    const overallPercent = getOverallFileTransferPercent(progress);
    const isRemoteSync = (status === FileStatus.DOWNLOADING || status === FileStatus.STARTED) && numberOfFiles > 0;
    const isUpload = status === FileStatus.UPLOADING;
    const showByteTotals = bytesTotal !== undefined && bytesTotal > 0;
    const showCurrentFileSize = currentFileSize !== undefined && currentFileSize > 0;
    const showFileCount = numberOfFiles > 0 && !isUpload;
    const showUploadFileCount = numberOfFiles > 0 && isUpload;

    // Total elapsed time for the whole transfer (not per-file). The timer
    // starts on the first STARTED/DOWNLOADING/UPLOADING tick and resets only
    // when the active session ends. All time reads happen inside the interval
    // callback so the render body stays pure.
    const [timer, setTimer] = useState<{ key: string; startedAt: number | null; now: number }>({
        key: '',
        startedAt: null,
        now: 0,
    });
    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setTimer((prev) => {
                let expectedKey = '';
                if (status === FileStatus.DOWNLOADING || status === FileStatus.STARTED) {
                    expectedKey = 'sync';
                } else if (status === FileStatus.UPLOADING) {
                    expectedKey = 'upload';
                }
                const tickNow = Date.now();
                if (expectedKey !== prev.key) {
                    return { key: expectedKey, startedAt: expectedKey === '' ? null : tickNow, now: tickNow };
                }
                return { ...prev, now: tickNow };
            });
        }, ELAPSED_REFRESH_MS);
        return () => window.clearInterval(intervalId);
    }, [status]);
    const elapsedSeconds = timer.startedAt === null ? 0 : Math.max(0, Math.floor((timer.now - timer.startedAt) / 1000));

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
                <h2 className='heading'>{isRemoteSync ? 'Remote sync progress' : 'File Transfer Progress'}</h2>
                {showFileCount && (
                    <p>
                        {finishedFiles}/{numberOfFiles} files{' '}
                        {showByteTotals &&
                            `(${formatMemorySize(bytesTransferred ?? 0, 1)} / ${formatMemorySize(bytesTotal, 1)})`}
                    </p>
                )}
                {showUploadFileCount && (
                    <p>
                        {numberOfFiles} files{' '}
                        {showByteTotals &&
                            `(${formatMemorySize(bytesTransferred ?? 0, 1)} / ${formatMemorySize(bytesTotal, 1)})`}
                    </p>
                )}

                {currentFileName && (
                    <p>
                        {shouldShowStatus(status) && getFileStatusLabel(status)} <u>{currentFileName}</u>
                        {showCurrentFileSize && <> ({formatMemorySize(currentFileSize, 1)})</>}
                    </p>
                )}
                <p>
                    {formatPercentage(overallPercent, 0)}
                    {elapsedSeconds > 0 && ` \u2014 ${formatElapsed(elapsedSeconds)}`}
                </p>
            </div>

            <ProgressBar
                progress={overallPercent / 100}
                ariaLabel='File transfer progress'
            />
        </Overlay>
    );
};

export default FileStatusOverlay;
