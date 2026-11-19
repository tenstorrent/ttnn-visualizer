// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import 'styles/components/StackTrace.scss';
import { StackTraceLanguage } from '../../definitions/StackTrace';
import { TEST_IDS } from '../../definitions/TestIds';
import hljs from '../../functions/highlightSource';
import {
    StackTraceFrame,
    getFrameSourceFileId,
    isFrameSourceInReport,
    parseStackTraceFrames,
    splitStackTraceLines,
} from '../../functions/stackTraceSource';
import canStackTraceExpand, { STACK_TRACE_PREVIEW_LINES } from '../../functions/canStackTraceExpand';
import SourceFileButton from './SourceFileButton';
import StackTraceFrameSource from './StackTraceFrameSource';
import { useReportSourceFiles } from '../../hooks/useAPI';
import { recordDrilldownOpened } from '../../functions/surfaceEvents';
import { DrilldownTarget } from '../../definitions/EventLogEvent';

interface StackTraceProps {
    title?: string;
    stackTrace: string;
    stackTraceSourceFileId?: number | null;
    language: StackTraceLanguage;
    hideSourceButton?: boolean;
    isInline?: boolean;
    // Supply these two props if you want to control the expanded state from outside
    isInitiallyExpanded?: boolean;
    onExpandChange?: (isVisible: boolean) => void;
    className?: string;
    intent?: Intent;
    // Set where the text is a stack trace, so expanding it records a drill-down. Off by
    // default because the component also shows error messages, which are not traces.
    recordsExpansion?: boolean;
}

function StackTrace({
    title,
    stackTrace,
    stackTraceSourceFileId = null,
    language,
    hideSourceButton,
    isInline,
    isInitiallyExpanded,
    onExpandChange,
    className,
    intent = Intent.NONE,
    recordsExpansion = false,
}: StackTraceProps) {
    const [isExpanded, setIsExpanded] = useState(isInitiallyExpanded || false);
    const [activeFrame, setActiveFrame] = useState<StackTraceFrame | null>(null);
    const [isFrameSourceOpen, setIsFrameSourceOpen] = useState(false);
    const scrollElementRef = useRef<null | HTMLPreElement>(null);

    const frames = useMemo(() => parseStackTraceFrames(stackTrace), [stackTrace]);
    // The Source button opens frame 0, the call site, through the same parse as its link.
    const callSite = frames[0] ?? null;

    const highlightedLines = useMemo(() => {
        const framesByLine = new Map<number, StackTraceFrame>(frames.map((frame) => [frame.lineIndex, frame]));
        const highlight = (text: string) => hljs.highlight(text, { language }).value;

        return splitStackTraceLines(stackTrace).map((text, lineIndex): HighlightedLine => {
            const frame = framesByLine.get(lineIndex) ?? null;

            return frame
                ? { frame, text: highlight(text), prefix: highlight(frame.prefix), suffix: highlight(frame.suffix) }
                : { frame, text: highlight(text), prefix: '', suffix: '' };
        });
    }, [stackTrace, frames, language]);

    const visibleLines = isExpanded ? highlightedLines : highlightedLines.slice(0, STACK_TRACE_PREVIEW_LINES);
    // A trace that fits in the preview has nothing more to show
    const canExpand = useMemo(() => canStackTraceExpand(stackTrace), [stackTrace]);
    // Frame links share the Source button's gate: panes that hide it show error text, not
    // a traceback whose files the report can open. Within it, only frames whose file the
    // report holds are linked; see `StackTraceFrameLine`.
    const showsFrameLinks = !hideSourceButton;

    const handleOpenFrame = useCallback((frame: StackTraceFrame) => {
        setActiveFrame(frame);
        setIsFrameSourceOpen(true);
    }, []);

    const handleCloseFrameSource = useCallback(() => setIsFrameSourceOpen(false), []);

    const handleToggleStackTrace = () => {
        setIsExpanded(!isExpanded);

        // Expanding only: collapsing a trace is not a drill-down, and one shown expanded
        // from the start was never opened.
        if (recordsExpansion && !isExpanded) {
            recordDrilldownOpened(DrilldownTarget.STACK_TRACE);
        }

        if (isExpanded && scrollElementRef?.current && !isTopOfElementInViewport(scrollElementRef.current)) {
            scrollElementRef?.current?.scrollIntoView();
        }

        if (onExpandChange) {
            onExpandChange(isExpanded);
        }
    };

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
                <div className='code-wrapper'>
                    <code className={`language-${language} code-output`}>
                        {visibleLines.map(({ frame, text, prefix, suffix }, lineIndex) => (
                            <div
                                // Lines are positional: the trace is read once and never reordered.
                                key={lineIndex}
                                className='ttnn-line'
                            >
                                <span className='line-number'>{lineIndex + 1}</span>
                                {frame && showsFrameLinks ? (
                                    <StackTraceFrameLine
                                        frame={frame}
                                        sourceFileId={stackTraceSourceFileId}
                                        text={text}
                                        prefix={prefix}
                                        suffix={suffix}
                                        onOpen={handleOpenFrame}
                                    />
                                ) : (
                                    <HighlightedText html={text} />
                                )}
                            </div>
                        ))}
                    </code>
                </div>

                <div className={classNames('stack-trace-buttons is-sticky')}>
                    {canExpand && (
                        <Button
                            variant={ButtonVariant.MINIMAL}
                            intent={Intent.PRIMARY}
                            onClick={handleToggleStackTrace}
                            text={isExpanded ? 'Collapse' : 'Expand'}
                            endIcon={isExpanded ? IconNames.MINIMIZE : IconNames.MAXIMIZE}
                        />
                    )}

                    {!hideSourceButton && (
                        <SourceFileButton
                            filePath={callSite?.file ?? ''}
                            sourceFileId={stackTraceSourceFileId}
                            lineNumber={callSite?.line ?? null}
                            language={language}
                            variant={ButtonVariant.MINIMAL}
                            intent={Intent.SUCCESS}
                            ariaLabel={title ? `View source for ${title}` : 'View source file'}
                            eagerProbe
                        />
                    )}
                </div>
            </pre>

            {activeFrame && showsFrameLinks ? (
                <StackTraceFrameSource
                    // A new frame, or the same position in another trace, reads its own file.
                    key={`${activeFrame.index}:${activeFrame.file}:${activeFrame.line}:${stackTraceSourceFileId}`}
                    filePath={activeFrame.file}
                    sourceFileId={getFrameSourceFileId(activeFrame, stackTraceSourceFileId)}
                    lineNumber={activeFrame.line}
                    language={language}
                    isOpen={isFrameSourceOpen}
                    onClose={handleCloseFrameSource}
                />
            ) : null}
        </div>
    );
}

interface StackTraceFrameLineProps {
    frame: StackTraceFrame;
    sourceFileId: number | null;
    text: string;
    prefix: string;
    suffix: string;
    onOpen: (frame: StackTraceFrame) => void;
}

/**
 * A frame's line, with its `"<file>", line <n>` linked when the report holds that file.
 * The report's `source_files` are the only source the viewer can show, so a frame whose
 * file is not among them stays plain text, as it does until the list has loaded.
 */
function StackTraceFrameLine({ frame, sourceFileId, text, prefix, suffix, onOpen }: StackTraceFrameLineProps) {
    const { data: sourceFiles } = useReportSourceFiles();

    if (!sourceFiles || !isFrameSourceInReport(frame, sourceFileId, sourceFiles)) {
        return <HighlightedText html={text} />;
    }

    return (
        <>
            <HighlightedText html={prefix} />
            <button
                type='button'
                className='stack-trace-frame-link'
                data-testid={TEST_IDS.STACK_TRACE_FRAME_LINK}
                aria-label={`View source for ${frame.file} at line ${frame.line}`}
                onClick={() => onOpen(frame)}
            >
                &quot;{frame.file}&quot;, line {frame.line}
            </button>
            <HighlightedText html={suffix} />
        </>
    );
}

interface HighlightedLine {
    frame: StackTraceFrame | null;
    // hljs output for the whole line, and for the text either side of a frame's link.
    text: string;
    prefix: string;
    suffix: string;
}

interface HighlightedTextProps {
    html: string;
}

function HighlightedText({ html }: HighlightedTextProps) {
    // HTML tags are escaped by hljs
    // eslint-disable-next-line react/no-danger
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function isTopOfElementInViewport(element: HTMLElement, scrollContainer?: React.RefObject<HTMLDivElement>): boolean {
    const elementPosition = element.getBoundingClientRect();
    const comparisonElementPosition = scrollContainer?.current
        ? scrollContainer.current.getBoundingClientRect().top
        : window.scrollY;

    return elementPosition.top > comparisonElementPosition;
}

export default StackTrace;
