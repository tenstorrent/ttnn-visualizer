// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
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

const UPLOAD_META = {
    heading: 'Uploading report',
    icon: IconNames.CLOUD_UPLOAD,
} as const;
const SYNC_META = {
    heading: 'Syncing remote report',
    icon: IconNames.CLOUD_DOWNLOAD,
} as const;

type DisplayMeta = typeof UPLOAD_META | typeof SYNC_META;

const FileStatusOverlay = () => {
    const [progress] = useAtom(fileTransferProgressAtom);
    // Total elapsed time for the whole transfer (not per-file). The interval
    // only runs while a transfer is active, so the mounted-but-idle overlay
    // does no per-second work. `startedAt` is stamped on the inactive→active
    // edge (render-time adjustment) so sub-second transfers are not under-
    // counted by up to one interval tick.
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [now, setNow] = useState(0);
    const { currentFileName, finishedFiles, numberOfFiles, status, bytesTransferred, bytesTotal, currentFileSize } =
        progress;
    const overallPercent = getOverallFileTransferPercent(progress);
    const isActive = isActiveTransferStatus(status);
    const isUpload = status === FileStatus.UPLOADING;
    const displayMeta: DisplayMeta = isUpload ? UPLOAD_META : SYNC_META;
    const showByteTotals = bytesTotal !== undefined && bytesTotal > 0;
    const showCurrentFileSize = currentFileSize !== undefined && currentFileSize > 0;
    const showFileCount = numberOfFiles > 0;
    // Uploads stream as a single multipart request, so the backend never
    // reports per-file completion (finishedFiles stays 0). Hide the `0/N`
    // prefix in that case to avoid showing misleading progress.
    const showFinishedCount = showFileCount && !isUpload;
    const elapsedSeconds = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));

    useEffect(() => {
        if (!isActive) {
            return undefined;
        }

        // Stamp before the first interval tick so elapsed time is accurate for
        // transfers shorter than ELAPSED_REFRESH_MS (Copilot PR feedback).
        const stamp = Date.now();
        /* eslint-disable react-hooks/set-state-in-effect -- synchronous init on activation; interval only bumps `now` */
        setStartedAt(stamp);
        setNow(stamp);
        /* eslint-enable react-hooks/set-state-in-effect */

        const intervalId = window.setInterval(() => {
            setNow(Date.now());
        }, ELAPSED_REFRESH_MS);

        return () => {
            window.clearInterval(intervalId);
            setStartedAt(null);
            setNow(0);
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
                <h2 className='heading'>
                    <Icon
                        icon={displayMeta.icon}
                        size={24}
                    />
                    {displayMeta.heading}
                </h2>
                {showFileCount && (
                    <p>
                        {showFinishedCount ? `File ${finishedFiles}/${numberOfFiles} ` : `${numberOfFiles} files `}
                        {showByteTotals &&
                            `(${formatMemorySize(bytesTransferred ?? 0, 1)} / ${formatMemorySize(bytesTotal, 1)})`}
                    </p>
                )}

                {(currentFileName || status === FileStatus.STARTED) && (
                    <p>
                        {getFileStatusLabel(status)}
                        {currentFileName && (
                            <>
                                {' '}
                                <u>{currentFileName}</u>
                                {showCurrentFileSize && <> ({formatMemorySize(currentFileSize, 1)})</>}
                            </>
                        )}
                    </p>
                )}
                <p>
                    {formatPercentage(overallPercent, 0)} complete
                    {/* Show elapsed from the moment the transfer becomes active
                        so sub-second transfers don't appear time-less. */}
                    {startedAt !== null && ` \u2014 ${formatElapsed(elapsedSeconds)}`}
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
