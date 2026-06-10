// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import React, { useMemo, useRef, useState } from 'react';
import 'styles/components/StackTrace.scss';
import { StackTraceLanguage } from '../../definitions/StackTrace';
import hljs from '../../functions/highlightSource';
import { getStackTraceFilePath, getStackTraceLineNumber } from '../../functions/stackTraceSource';
import SourceFileButton from './SourceFileButton';

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
}: StackTraceProps) {
    const [isExpanded, setIsExpanded] = useState(isInitiallyExpanded || false);
    const filePath = useMemo(() => getStackTraceFilePath(stackTrace), [stackTrace]);
    const lineNumber = useMemo(() => getStackTraceLineNumber(stackTrace), [stackTrace]);
    const scrollElementRef = useRef<null | HTMLPreElement>(null);

    const stackTraceWithHighlights = useMemo(() => {
        let highlightedFileContents = hljs.highlight(stackTrace, { language }).value;

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

    const handleToggleStackTrace = () => {
        setIsExpanded(!isExpanded);

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
                    <code
                        className={`language-${language} code-output`}
                        // HTML tags are escaped by hljs
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{
                            __html: isExpanded
                                ? stackTraceWithHighlights
                                : getStackTracePreview(stackTraceWithHighlights),
                        }}
                    />
                </div>

                <div className={classNames('stack-trace-buttons is-sticky')}>
                    <Button
                        variant={ButtonVariant.MINIMAL}
                        intent={Intent.PRIMARY}
                        onClick={handleToggleStackTrace}
                        text={isExpanded ? 'Collapse' : 'Expand'}
                        endIcon={isExpanded ? IconNames.MINIMIZE : IconNames.MAXIMIZE}
                    />

                    {!hideSourceButton && (
                        <SourceFileButton
                            filePath={filePath}
                            sourceFileId={stackTraceSourceFileId}
                            lineNumber={lineNumber}
                            language={language}
                            variant={ButtonVariant.MINIMAL}
                            intent={Intent.SUCCESS}
                            ariaLabel={title ? `View source for ${title}` : 'View source file'}
                            eagerProbe
                        />
                    )}
                </div>
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

export default StackTrace;
