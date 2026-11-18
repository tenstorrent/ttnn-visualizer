// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from 'react';
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
    onClose: () => void;
}

/**
 * The source viewer for one stack trace frame. Mounted on the frame's first click, keyed by
 * frame, so a trace never probes a frame nobody opened: on a remote report every probe is an
 * SSH round trip.
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
    const { matchedViaRemap, fileContents, errorDetails, resolvedPath, probe, readSource } = useSourceFile(
        filePath,
        sourceFileId,
    );

    useEffect(() => {
        let isCurrent = true;

        (async () => {
            await probe();
            // Read even when the probe says the file is unavailable: the read's error says
            // why, where skipping it would leave the click doing nothing.
            await readSource();

            if (isCurrent) {
                setHasRead(true);
            }
        })();

        return () => {
            isCurrent = false;
        };
        // Once per mount: the parent remounts this per frame, and `readSource` changes
        // identity when the contents arrive, which must not read the file again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isVisible = isOpen && hasRead;

    useEffect(() => {
        if (isVisible) {
            recordDrilldownOpened(DrilldownTarget.SOURCE_FILE);
        }
    }, [isVisible]);

    return hasRead ? (
        <SourceFileOverlay
            isOpen={isVisible}
            onClose={onClose}
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
