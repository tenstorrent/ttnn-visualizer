// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useState } from 'react';
import { DrilldownTarget } from '../../definitions/EventLogEvent';
import { StackTraceLanguage } from '../../definitions/StackTrace';
import { recordDrilldownOpened } from '../../functions/surfaceEvents';
import { useSourceFile } from '../../hooks/useSourceFile';
import SourceFileOverlay from './SourceFileOverlay';

interface StackTraceFrameSourceProps {
    filePath: string;
    sourceFileId: number | null;
    lineNumber: number;
    language: StackTraceLanguage;
    isOpen: boolean;
    // Says whether the read failed, so the parent can drop this viewer and read afresh on
    // the next click rather than reopen on a stale error.
    onClose: (readFailed: boolean) => void;
}

/**
 * The source viewer for one stack trace frame. Mounted on the frame's first click, keyed by
 * frame, so a trace never reads a frame nobody opened. Closing and reopening the same frame
 * reuses a successful read; opening another frame in between replaces this viewer, so coming
 * back reads the file again.
 */
function StackTraceFrameSource({
    filePath,
    sourceFileId,
    lineNumber,
    language,
    isOpen,
    onClose,
}: StackTraceFrameSourceProps) {
    const [hasRead, setHasRead] = useState(false);
    const { matchedViaRemap, fileContents, errorDetails, resolvedPath, readSource } = useSourceFile(
        filePath,
        sourceFileId,
    );

    useEffect(() => {
        let isCurrent = true;

        (async () => {
            // No availability probe first: a frame is linked only when the report lists its
            // file, so a probe could only agree. A read that still fails opens the viewer on
            // its error.
            await readSource();

            if (isCurrent) {
                setHasRead(true);
            }
        })();

        return () => {
            isCurrent = false;
        };
        // One read per mount: the parent remounts this per frame. `readSource` changes only
        // when the read stores the file's contents, and it returns early once they are there.
    }, [readSource]);

    const isVisible = isOpen && hasRead;
    const handleClose = useCallback(() => onClose(!!errorDetails), [onClose, errorDetails]);

    useEffect(() => {
        if (isVisible) {
            recordDrilldownOpened(DrilldownTarget.SOURCE_FILE);
        }
    }, [isVisible]);

    return hasRead ? (
        <SourceFileOverlay
            isOpen={isVisible}
            onClose={handleClose}
            language={language}
            lineNumber={lineNumber}
            fileContents={fileContents}
            errorDetails={errorDetails}
            resolvedPath={resolvedPath}
            filePath={filePath}
            matchedViaRemap={matchedViaRemap}
            scrollToLineNumber
        />
    ) : null;
}

export default StackTraceFrameSource;
