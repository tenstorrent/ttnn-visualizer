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
    const [openedFrame, setOpenedFrame] = useState<OpenedFrame | null>(null);
    const scrollElementRef = useRef<null | HTMLPreElement>(null);

    // The component outlives its trace: the operation details page swaps in another
    // operation's trace without remounting it. A frame opened in the old trace is forgotten
    // then, or its source would be read again for a trace nobody clicked in, and frame 0's
    // old path sent with the new trace's source file id.
    if (openedFrame && (openedFrame.stackTrace !== stackTrace || openedFrame.sourceFileId !== stackTraceSourceFileId)) {
        setOpenedFrame(null);
    }

    const frames = useMemo(() => parseStackTraceFrames(stackTrace), [stackTrace]);
    // The Source button opens frame 0, the call site, through the same parse as its link.
    const callSite = frames[0] ?? null;
    const lines = useMemo(() => splitStackTraceLines(stackTrace), [stackTrace]);
    // A trace that fits in the preview has nothing more to show
    const canExpand = useMemo(() => canStackTraceExpand(stackTrace), [stackTrace]);
    // Frame links share the Source button's gate: panes that hide it show error text, not
    // a traceback whose files the report can open. Within it, only frames whose file the
    // report holds are linked; see `StackTraceFrameLine`.
    const showsFrameLinks = !hideSourceButton;

    // Only the lines on screen are highlighted, one hljs call each, so a long collapsed
    // trace costs its preview. The text either side of a frame's link is highlighted only
    // where links can show.
    const visibleLines = useMemo(() => {
        const framesByLine = new Map<number, StackTraceFrame>(frames.map((frame) => [frame.lineIndex, frame]));
        const highlight = (text: string) => hljs.highlight(text, { language }).value;
        const shownLines = isExpanded ? lines : lines.slice(0, STACK_TRACE_PREVIEW_LINES);

        return shownLines.map((text, lineIndex): HighlightedLine => {
            const frame = framesByLine.get(lineIndex) ?? null;

            return frame && showsFrameLinks
                ? { frame, text: highlight(text), prefix: highlight(frame.prefix), suffix: highlight(frame.suffix) }
                : { frame: null, text: highlight(text), prefix: '', suffix: '' };
        });
    }, [lines, frames, language, isExpanded, showsFrameLinks]);

    const activeFrame = openedFrame?.frame ?? null;

    const handleOpenFrame = useCallback(
        (frame: StackTraceFrame) =>
            setOpenedFrame({ frame, stackTrace, sourceFileId: stackTraceSourceFileId, isOpen: true }),
        [stackTrace, stackTraceSourceFileId],
    );

    // A successful read is kept for reopening the frame, until another frame is opened. A failed
    // one is dropped, so the next click reads again: the failure may have been transient.
    const handleCloseFrameSource = useCallback(
        (readFailed: boolean) =>
            setOpenedFrame((opened) => (opened && !readFailed ? { ...opened, isOpen: false } : null)),
        [],
    );

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
                                {frame ? (
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
                    // Another frame mounts its own viewer and reads its own file.
                    key={`${activeFrame.index}:${activeFrame.file}:${activeFrame.line}`}
                    filePath={activeFrame.file}
                    sourceFileId={getFrameSourceFileId(activeFrame, stackTraceSourceFileId)}
                    lineNumber={activeFrame.line}
                    language={language}
                    isOpen={openedFrame?.isOpen ?? false}
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
 * A frame's line, with its `"<file>", line <n>` linked when the report holds that file in
 * its `source_files`, and plain text otherwise, as every frame is until that list loads.
 * Outside server mode the read could also find a file in a tt-metal checkout or over SSH,
 * but finding out means probing each frame (an SSH round trip on remote reports), so only
 * the report's own files are linked, in both modes. The Source button still falls back.
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
                // Starts with the visible text, so voice control can name it by what it shows.
                aria-label={`"${frame.file}", line ${frame.line}: view source`}
                onClick={() => onOpen(frame)}
            >
                &quot;{frame.file}&quot;, line {frame.line}
            </button>
            <HighlightedText html={suffix} />
        </>
    );
}

interface OpenedFrame {
    frame: StackTraceFrame;
    // The trace and source file id it was opened in, to forget it when either changes.
    stackTrace: string;
    sourceFileId: number | null;
    isOpen: boolean;
}

interface HighlightedLine {
    frame: StackTraceFrame | null;
    // hljs output for the whole line, and for the text either side of a frame's link.
    text: string;
    prefix: string;
    suffix: string;
}

interface HighlightedTextProps {
    // Only ever `hljs.highlight(...).value`; see `HighlightedText`.
    html: string;
}

/**
 * Renders hljs output as HTML. That is safe only because `html` is hljs output, and nothing
 * else may be passed here. hljs escapes `&`, `<`, `>`, `"` and `'` in every piece of text it
 * adds, and the only markup it writes is `<span class="hljs-…">` with class names from the
 * grammar, never from the input. Its error fallbacks escape the input the same way. A trace
 * is report data, so a function name or error message can hold markup; the test "escapes
 * markup in the trace" pins that it renders as text. SAST tools flag this line regardless.
 */
function HighlightedText({ html }: HighlightedTextProps) {
    // eslint-disable-next-line react/no-danger -- `html` is escaped hljs output, as above
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
