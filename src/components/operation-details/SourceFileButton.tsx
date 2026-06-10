// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent, PopoverPosition, Size, Tooltip } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { useState } from 'react';
import { SourceFileStatus, StackTraceLanguage } from '../../definitions/StackTrace';
import getServerConfig from '../../functions/getServerConfig';
import { useSourceFile } from '../../hooks/useSourceFile';
import SourceFileOverlay from './SourceFileOverlay';

interface SourceFileButtonProps {
    filePath: string;
    sourceFileId: number | null;
    lineNumber: number | null;
    language: StackTraceLanguage;
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

    // When eagerly probing, keep the button disabled until the probe confirms the source is
    // available — the answer arrives on mount, so there's no reason to offer a click that will
    // just resolve to "unavailable".
    const isUnavailable =
        !canProbeSource ||
        status === SourceFileStatus.Unavailable ||
        (eagerProbe && status !== SourceFileStatus.Available);
    const isChecking = status === SourceFileStatus.Pending || isFetching;
    const tooltipContent = getSourceTooltipContents(!!getServerConfig()?.SERVER_MODE, canProbeSource, status);

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
            <Tooltip
                content={tooltipContent}
                placement={PopoverPosition.TOP}
            >
                <Button
                    className={className}
                    variant={variant}
                    intent={intent}
                    size={size}
                    endIcon={endIcon}
                    text='Source'
                    aria-label={ariaLabel}
                    data-testid={testId}
                    disabled={isUnavailable}
                    loading={isChecking}
                    onClick={handleClick}
                    onMouseEnter={() => probe()}
                    onFocus={() => probe()}
                />
            </Tooltip>

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

/**
 * Source button tooltip. Always rendered so it appears on the first hover even while the
 * availability probe is still resolving (the message updates live as `status` settles).
 * Intentionally generic for all ``StackSourceOrigin`` values (database, path, remapped).
 */
function getSourceTooltipContents(serverMode: boolean, canProbeSource: boolean, status: SourceFileStatus): string {
    if (!canProbeSource) {
        return 'No file path found for this stack trace';
    }

    if (status === SourceFileStatus.Pending) {
        return 'Checking whether source file is available…';
    }

    if (status === SourceFileStatus.Unavailable) {
        return serverMode ? 'Source file is not available in this report' : 'Source file is not available';
    }

    return 'View source file';
}

export default SourceFileButton;
