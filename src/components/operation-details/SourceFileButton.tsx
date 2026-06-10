// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent, Size } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { useState } from 'react';
import { SourceFileStatus, StackTraceLanguage } from '../../definitions/StackTrace';
import { useSourceFile } from '../../hooks/useSourceFile';
import SourceFileOverlay from './SourceFileOverlay';

interface SourceFileButtonProps {
    filePath: string;
    sourceFileId: number | null;
    lineNumber: number | null;
    language: StackTraceLanguage;
    text?: string;
    ariaLabel?: string;
    testId?: string;
    className?: string;
    size?: Size;
    variant?: ButtonVariant;
    intent?: Intent;
    endIcon?: IconName;
    // Probe availability on mount; leave false for many-instance surfaces.
    eagerProbe?: boolean;
}

function SourceFileButton({
    filePath,
    sourceFileId,
    lineNumber,
    language,
    text = 'Source',
    ariaLabel,
    testId,
    className,
    size,
    variant = ButtonVariant.OUTLINED,
    intent = Intent.PRIMARY,
    endIcon = IconNames.DOCUMENT_OPEN,
    eagerProbe = false,
}: SourceFileButtonProps) {
    const [isViewingSourceFile, setIsViewingSourceFile] = useState(false);
    const {
        canProbeSource,
        status,
        matchedViaRemap,
        isFetching,
        fileContents,
        errorDetails,
        resolvedPath,
        probe,
        readSource,
    } = useSourceFile(filePath, sourceFileId, { eager: eagerProbe });

    const isUnavailable = !canProbeSource || status === SourceFileStatus.Unavailable;
    const isChecking = status === SourceFileStatus.Pending || isFetching;

    const handleClick = async () => {
        const available = await probe();

        if (!available) {
            return;
        }

        await readSource();
        setIsViewingSourceFile(true);
    };

    return (
        <>
            <Button
                className={className}
                variant={variant}
                intent={intent}
                size={size}
                endIcon={endIcon}
                text={text}
                aria-label={ariaLabel}
                data-testid={testId}
                disabled={isUnavailable}
                loading={isChecking}
                onClick={handleClick}
                onMouseEnter={() => probe()}
                onFocus={() => probe()}
            />

            <SourceFileOverlay
                isOpen={isViewingSourceFile}
                onClose={() => setIsViewingSourceFile(false)}
                language={language}
                lineNumber={lineNumber}
                fileContents={fileContents}
                errorDetails={errorDetails}
                resolvedPath={resolvedPath}
                filePath={filePath}
                matchedViaRemap={matchedViaRemap}
                scrollToLineNumber
            />
        </>
    );
}

export default SourceFileButton;
