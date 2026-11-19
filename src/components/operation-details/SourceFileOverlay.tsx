// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, Callout, Classes, Intent, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'styles/components/StackTrace.scss';
import { ReportLocation } from '../../definitions/Reports';
import { StackTraceLanguage } from '../../definitions/StackTrace';
import hljs from '../../functions/highlightSource';
import { useReportMetadata } from '../../hooks/useAPI';
import useRemoteConnection from '../../hooks/useRemote';
import { profilerReportLocationAtom } from '../../store/app';
import Overlay from '../Overlay';
import GitCommitInfo from './GitCommitInfo';

interface SourceFileOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    language: StackTraceLanguage;
    lineNumber: number | null;
    fileContents: string;
    errorDetails: string;
    resolvedPath: string | null;
    filePath: string;
    matchedViaRemap: boolean;
    scrollToLineNumber: boolean;
}

function SourceFileOverlay({
    isOpen,
    onClose,
    language,
    lineNumber,
    fileContents,
    errorDetails,
    resolvedPath,
    filePath,
    matchedViaRemap,
    scrollToLineNumber = false,
}: SourceFileOverlayProps) {
    const { data: reportMetadata } = useReportMetadata();
    const gitUrl = reportMetadata?.gitUrl ?? null;
    const gitSha = reportMetadata?.gitSha ?? null;
    const isRemote = useAtomValue(profilerReportLocationAtom) === ReportLocation.REMOTE;
    const { persistentState } = useRemoteConnection();

    const [scrollContainerEl, setScrollContainerEl] = useState<Element | null>(null);
    const [overlayTopOffset, setOverlayTopOffset] = useState<number>(0);
    const sourceControlsRef = useRef<null | HTMLDivElement>(null);
    // State rather than a ref so the auto-scroll effect reruns once the file is in the document.
    // Blueprint's Portal renders its children only after its own effect has created the
    // container, so on a first open, when the overlay mounts already open, the lines arrive a
    // render after this component's effects have run.
    const [codeEl, setCodeEl] = useState<HTMLElement | null>(null);
    const didAutoScrollRef = useRef(false);

    const fileWithHighlights = useMemo(() => {
        if (!fileContents) {
            return '';
        }

        let highlightedFileContents = hljs.highlight(fileContents, { language }).value;

        let line = 1;
        highlightedFileContents = highlightedFileContents.replace(/^/gm, () => {
            const classes = line === lineNumber ? 'ttnn-line highlighted-line' : 'ttnn-line';
            return `<div class="${classes}"><span class="line-number">${line++}</span>`;
        });
        highlightedFileContents = highlightedFileContents.replace(
            /<div class="ttnn-line">|<div class="ttnn-line highlighted-line">/gm,
            (match) => `</div>${match}`,
        );

        return highlightedFileContents;
    }, [fileContents, lineNumber, language]);

    const displaySourcePath = useMemo(() => {
        const path = (resolvedPath || filePath).trim();

        if (isRemote && persistentState.selectedConnection) {
            const { selectedConnection: remoteConnection } = persistentState;
            const connectionLabel = `${remoteConnection.username || 'user'}@${remoteConnection.host || 'host'}`;
            return `[${connectionLabel}] ${path}`;
        }

        return path;
    }, [isRemote, persistentState, resolvedPath, filePath]);

    const sourcePathWithGit = (
        <p className='stack-trace-path monospace'>
            {displaySourcePath}
            <GitCommitInfo
                gitUrl={gitUrl}
                gitSha={gitSha}
            />
        </p>
    );

    const scrollToTop = () => scrollContainerEl?.scrollTo({ top: 0, behavior: 'smooth' });
    const scrollToBottom = () =>
        scrollContainerEl?.scrollTo({ top: scrollContainerEl.scrollHeight, behavior: 'smooth' });

    useEffect(() => {
        if (!scrollContainerEl) {
            if (sourceControlsRef?.current) {
                const scrollEl = sourceControlsRef.current.closest(`.${Classes.OVERLAY_SCROLL_CONTAINER}`);
                const overlayEl = scrollEl?.querySelector(`.${Classes.OVERLAY_CONTENT}`);

                setScrollContainerEl(scrollEl || null);

                if (overlayEl) {
                    const overlayStyles = window.getComputedStyle(overlayEl);
                    setOverlayTopOffset(parseInt(overlayStyles.marginTop, 10) || 0);
                }
            }
        }

        const handleScroll = () => {
            const controlsEl = sourceControlsRef.current;

            if (!controlsEl || !scrollContainerEl || Number.isNaN(overlayTopOffset)) {
                return;
            }

            const { scrollTop } = scrollContainerEl;

            if (scrollTop > overlayTopOffset) {
                controlsEl.style.transform = `translateY(${scrollTop - overlayTopOffset}px)`;
            } else {
                controlsEl.style.transform = '';
            }
        };

        scrollContainerEl?.addEventListener('scroll', handleScroll);

        return () => scrollContainerEl?.removeEventListener('scroll', handleScroll);
    }, [scrollContainerEl, overlayTopOffset, isOpen]);

    useEffect(() => {
        if (!isOpen) {
            didAutoScrollRef.current = false;
            return undefined;
        }

        if (
            !scrollToLineNumber ||
            didAutoScrollRef.current ||
            !codeEl ||
            !fileWithHighlights ||
            errorDetails ||
            lineNumber == null
        ) {
            return undefined;
        }

        // Wait until highlighted HTML is painted before trying to scroll. Only a scroll that found
        // its line counts, so a frame that fires too early leaves the next render to try again.
        const frame = requestAnimationFrame(() => {
            didAutoScrollRef.current = scrollToHighlightedLine(codeEl);
        });

        return () => cancelAnimationFrame(frame);
    }, [isOpen, scrollToLineNumber, codeEl, fileWithHighlights, errorDetails, lineNumber]);

    return (
        <Overlay
            isOpen={isOpen}
            onClose={onClose}
            lazy={false}
        >
            <>
                {!errorDetails ? (
                    <div
                        className='source-file-controls'
                        ref={sourceControlsRef}
                    >
                        <div className='buttons'>
                            <Tooltip content='Scroll to top'>
                                <Button
                                    icon={IconNames.DOUBLE_CHEVRON_UP}
                                    onClick={scrollToTop}
                                />
                            </Tooltip>

                            <Tooltip content='Scroll to highlighted line'>
                                <Button
                                    icon={IconNames.LOCATE}
                                    onClick={() => scrollToHighlightedLine(codeEl)}
                                />
                            </Tooltip>

                            <Tooltip content='Scroll to bottom'>
                                <Button
                                    icon={IconNames.DOUBLE_CHEVRON_DOWN}
                                    onClick={scrollToBottom}
                                />
                            </Tooltip>
                        </div>
                    </div>
                ) : null}

                {errorDetails ? (
                    <div className='stack-trace-error'>
                        {sourcePathWithGit}
                        <div className='error-details'>
                            <pre>{errorDetails}</pre>
                        </div>
                    </div>
                ) : null}

                {fileWithHighlights && !errorDetails ? (
                    <div className='stack-trace'>
                        {sourcePathWithGit}
                        {matchedViaRemap ? (
                            <Callout
                                className='stack-trace-source-remap-notice'
                                intent={Intent.WARNING}
                                title='Approximate source match'
                            >
                                This file was opened using a remapped path which may not reflect the same file or
                                revision that produced the trace.
                            </Callout>
                        ) : null}
                        <code
                            ref={setCodeEl}
                            className={`language-${language} code-output`}
                            // HTML tags are escaped by hljs
                            // eslint-disable-next-line react/no-danger
                            dangerouslySetInnerHTML={{
                                __html: fileWithHighlights,
                            }}
                        />
                    </div>
                ) : null}
            </>
        </Overlay>
    );
}

/**
 * Scroll this overlay's highlighted line into view, returning whether it was found. Looked up
 * within the overlay's own code, not the whole document, so another source overlay's line can
 * never be the one scrolled to.
 */
const scrollToHighlightedLine = (codeEl: HTMLElement | null): boolean => {
    const lineElement = codeEl?.querySelector('.highlighted-line .line-number');

    if (!lineElement || typeof lineElement.scrollIntoView !== 'function') {
        return false;
    }

    lineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
};

export default SourceFileOverlay;
