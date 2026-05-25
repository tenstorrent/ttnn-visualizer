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
import { getFileStatusLabel, isActiveTransferStatus } from '../functions/getFileStatusLabel';
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

interface FileStatusOverlayProps {
    heading: string;
}

const FileStatusOverlay = ({ heading }: FileStatusOverlayProps) => {
    const [progress] = useAtom(fileTransferProgressAtom);
    // Total elapsed time for the whole transfer (not per-file). The interval
    // only runs while the overlay is active, so an idle overlay mounted in a
    // parent page does no per-second work. All time reads happen inside the
    // interval callback so the render body stays pure.
    const [timer, setTimer] = useState<{ startedAt: number | null; now: number }>({
        startedAt: null,
        now: 0,
    });
    const { currentFileName, finishedFiles, numberOfFiles, status, bytesTransferred, bytesTotal, currentFileSize } =
        progress;
    const overallPercent = getOverallFileTransferPercent(progress);
    const isActive = isActiveTransferStatus(status);
    const isUpload = status === FileStatus.UPLOADING;
    const showByteTotals = bytesTotal !== undefined && bytesTotal > 0;
    const showCurrentFileSize = currentFileSize !== undefined && currentFileSize > 0;
    const showFileCount = numberOfFiles > 0;
    // Uploads stream as a single multipart request, so the backend never
    // reports per-file completion (finishedFiles stays 0). Hide the `0/N`
    // prefix in that case to avoid showing misleading progress.
    const showFinishedCount = showFileCount && !isUpload;
    const elapsedSeconds = timer.startedAt === null ? 0 : Math.max(0, Math.floor((timer.now - timer.startedAt) / 1000));

    useEffect(() => {
        if (!isActive) {
            return undefined;
        }

        const intervalId = window.setInterval(() => {
            setTimer((prev) => {
                const tickNow = Date.now();
                if (prev.startedAt === null) {
                    return { startedAt: tickNow, now: tickNow };
                }
                return { ...prev, now: tickNow };
            });
        }, ELAPSED_REFRESH_MS);

        return () => {
            window.clearInterval(intervalId);
            setTimer((prev) => (prev.startedAt === null ? prev : { startedAt: null, now: 0 }));
        };
    }, [isActive]);

    return (
        <Overlay
            isOpen={isActive}
            hideCloseButton
            canEscapeKeyClose={false}
            canOutsideClickClose={false}
        >
            <div className='overlay'>
                <h2 className='heading'>{heading}</h2>
                {showFileCount && (
                    <p>
                        {showFinishedCount ? `${finishedFiles}/${numberOfFiles}` : `${numberOfFiles} files`}
                        {showByteTotals &&
                            `(${formatMemorySize(bytesTransferred ?? 0, 1)} / ${formatMemorySize(bytesTotal, 1)})`}
                    </p>
                )}

                {currentFileName && (
                    <p>
                        {getFileStatusLabel(status)} <u>{currentFileName}</u>
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
