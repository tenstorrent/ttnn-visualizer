// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import cpp from 'highlight.js/lib/languages/cpp';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'highlight.js/styles/a11y-dark.css';
import { Button, ButtonVariant, Classes, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { profilerReportLocationAtom } from '../../store/app';
import useRemoteConnection from '../../hooks/useRemote';
import Overlay from '../Overlay';
import 'styles/components/StackTrace.scss';
import { ReportLocation } from '../../definitions/Reports';
import { StackTraceLanguage } from '../../definitions/StackTrace';

hljs.registerLanguage(StackTraceLanguage.PYTHON, python);
hljs.registerLanguage(StackTraceLanguage.CPP, cpp);

const FILE_PATH_REGEX = /File "(.*)"/m;
const LINE_NUMBER_REGEX = /line (\d*),/m;

interface StackTraceProps {
    title?: string;
    stackTrace: string;
    language: StackTraceLanguage;
    hideSourceButton?: boolean;
    isInline?: boolean;
    // Supply these two props if you want to control the expanded state from outside
    isInitiallyExpanded?: boolean;
    onExpandChange?: (isVisible: boolean) => void;
    className?: string;
    intent?: Intent;
}

function StackTrace({
    title,
    stackTrace,
    language,
    hideSourceButton,
    isInline,
    isInitiallyExpanded,
    onExpandChange,
    className,
    intent = Intent.NONE,
}: StackTraceProps) {
    // TODO: See if you can read the remote file and use setCanReadRemoteFile appropriately
    // const [canReadRemoteFile, setCanReadRemoteFile] = useState(true);
    const isRemote = useAtomValue(profilerReportLocationAtom) === ReportLocation.REMOTE;

    const [isExpanded, setIsExpanded] = useState(isInitiallyExpanded || false);
    const [filePath, setFilePath] = useState('');
    const [isFetchingFile, setIsFetchingFile] = useState(false);
    const [fileContents, setFileContents] = useState('');
    const [errorDetails, setErrorDetails] = useState('');
    const [isViewingSourceFile, setIsViewingSourceFile] = useState(false);
    const [scrollContainerEl, setScrollContainerEl] = useState<Element | null>(null);
    const [overlayTopOffset, setOverlayTopOffset] = useState<number>(0);

    const { readRemoteFile, persistentState } = useRemoteConnection();
    const scrollElementRef = useRef<null | HTMLPreElement>(null);
    const sourceControlsRef = useRef<null | HTMLDivElement>(null);

    const stackTraceWithHighlights = useMemo(() => {
        const filePathMatches = FILE_PATH_REGEX.exec(stackTrace);
        let highlightedFileContents = hljs.highlight(stackTrace, { language }).value;

        if (filePathMatches) {
            setFilePath(filePathMatches[1]);
        }

        let line = 1;
        highlightedFileContents = highlightedFileContents.replace(
            /^/gm,
            () => `<div class="ttnn-line"><span class="line-number">${line++}</span>`,
        );
        highlightedFileContents = highlightedFileContents.replace(
            /<div class="ttnn-line">/gm,
            (match) => `</div>${match}`,
        );

        return highlightedFileContents;
    }, [stackTrace, language]);

    const fileWithHighlights = useMemo(() => {
        const lineNumberMatches = LINE_NUMBER_REGEX.exec(stackTrace);

        if (fileContents && lineNumberMatches?.[1]) {
            let highlightedFileContents = hljs.highlight(fileContents, { language }).value;

            let line = 1;
            highlightedFileContents = highlightedFileContents.replace(/^/gm, () => {
                const classes =
                    line === parseInt(lineNumberMatches?.[1], 10) ? 'ttnn-line highlighted-line' : 'ttnn-line';
                return `<div class="${classes}"><span class="line-number">${line++}</span>`;
            });
            highlightedFileContents = highlightedFileContents.replace(
                /<div class="ttnn-line">|<div class="ttnn-line highlighted-line">/gm,
                (match) => `</div>${match}`,
            );

            return highlightedFileContents;
        }

        return '';
    }, [fileContents, stackTrace, language]);

    const toggleViewingFile = useCallback(() => setIsViewingSourceFile((open) => !open), [setIsViewingSourceFile]);

    const handleReadRemoteFile = async () => {
        const { selectedConnection } = persistentState;

        if (fileContents) {
            setIsViewingSourceFile(true);
            return;
        }

        if (selectedConnection && !fileContents && isRemote) {
            setIsFetchingFile(true);

            const { data, error } = await readRemoteFile(filePath);

            if (error) {
                setErrorDetails(error);
            } else if (data) {
                setFileContents(data);
            }

            setIsFetchingFile(false);
            setIsViewingSourceFile(true);
        }
    };

    const handleToggleStackTrace = () => {
        setIsExpanded(!isExpanded);

        if (isExpanded && scrollElementRef?.current && !isTopOfElementInViewport(scrollElementRef.current)) {
            scrollElementRef?.current?.scrollIntoView();
        }

        if (onExpandChange) {
            onExpandChange(isExpanded);
        }
    };

    const scrollToTop = () => {
        if (scrollContainerEl) {
            scrollContainerEl.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const scrollToBottom = () => {
        if (scrollContainerEl) {
            scrollContainerEl.scrollTo({ top: scrollContainerEl.scrollHeight, behavior: 'smooth' });
        }
    };

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
    }, [scrollContainerEl, overlayTopOffset, isViewingSourceFile]);

    useEffect(() => {
        setFileContents('');
        setErrorDetails('');
    }, [stackTrace]);

    return (
        <div className={classNames('stack-trace', className)}>
            {title && <p className='stack-trace-title'>{title}</p>}
            <pre
                className={classNames('formatted-code', {
                    'is-inline': isInline,
                    'intent-danger': intent === Intent.DANGER,
                })}
                ref={scrollElementRef}
            >
                {isExpanded ? (
                    <div className='code-wrapper'>
                        <code
                            className={`language-${language} code-output`}
                            // eslint-disable-next-line react/no-danger
                            dangerouslySetInnerHTML={{ __html: stackTraceWithHighlights }}
                        />
                    </div>
                ) : (
                    <div className='code-wrapper'>
                        <code
                            className={`language-${language} code-output`}
                            // eslint-disable-next-line react/no-danger
                            dangerouslySetInnerHTML={{
                                __html: getStackTracePreview(stackTraceWithHighlights),
                            }}
                        />
                    </div>
                )}

                <div className={classNames('stack-trace-buttons is-sticky')}>
                    <Button
                        variant={ButtonVariant.MINIMAL}
                        intent={Intent.PRIMARY}
                        onClick={handleToggleStackTrace}
                        text={isExpanded ? 'Collapse' : 'Expand'}
                        endIcon={isExpanded ? IconNames.MINIMIZE : IconNames.MAXIMIZE}
                    />

                    {!hideSourceButton && (
                        <Tooltip
                            content={isRemote ? 'View external source file' : 'Cannot view local source file'}
                            placement={PopoverPosition.TOP}
                        >
                            <Button
                                variant={ButtonVariant.MINIMAL}
                                intent={Intent.SUCCESS}
                                onClick={handleReadRemoteFile}
                                endIcon={IconNames.DOCUMENT_OPEN}
                                text='Source'
                                disabled={isFetchingFile || !persistentState.selectedConnection || !isRemote}
                                loading={isFetchingFile}
                            />
                        </Tooltip>
                    )}
                </div>

                <Overlay
                    isOpen={isViewingSourceFile}
                    onClose={toggleViewingFile}
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
                                            onClick={() => scrollToTop()}
                                        />
                                    </Tooltip>

                                    <Tooltip content='Scroll to highlighted line'>
                                        <Button
                                            icon={IconNames.LOCATE}
                                            onClick={() => scrollToLineNumberInFile()}
                                        />
                                    </Tooltip>

                                    <Tooltip content='Scroll to bottom'>
                                        <Button
                                            icon={IconNames.DOUBLE_CHEVRON_DOWN}
                                            onClick={() => scrollToBottom()}
                                        />
                                    </Tooltip>
                                </div>
                            </div>
                        ) : null}
                        {errorDetails ? (
                            <div className='stack-trace-error'>
                                <p className='stack-trace-path monospace'>{filePath.trim()}</p>
                                <div className='error-details'>
                                    <pre>{errorDetails}</pre>
                                </div>
                            </div>
                        ) : null}

                        {fileWithHighlights && !errorDetails ? (
                            <div className='stack-trace'>
                                <p className='stack-trace-path monospace'>{filePath.trim()}</p>
                                <code
                                    className={`language-${language} code-output`}
                                    // eslint-disable-next-line react/no-danger
                                    dangerouslySetInnerHTML={{
                                        __html: fileWithHighlights,
                                    }}
                                />
                            </div>
                        ) : null}
                    </>
                </Overlay>
            </pre>
        </div>
    );
}

function getStackTracePreview(stackTrace: string) {
    const splitTrace: Array<string> = stackTrace.split('<span class="line-number">').splice(0, 3);

    return splitTrace.join('<span class="line-number">');
}

function isTopOfElementInViewport(element: HTMLElement, scrollContainer?: React.RefObject<HTMLDivElement>): boolean {
    const elementPosition = element.getBoundingClientRect();
    const comparisonElementPosition = scrollContainer?.current
        ? scrollContainer.current.getBoundingClientRect().top
        : window.scrollY;

    return elementPosition.top > comparisonElementPosition;
}

const scrollToLineNumberInFile = () => {
    const lineElement = document.querySelector(`.highlighted-line .line-number`);

    if (lineElement) {
        lineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

export default StackTrace;
