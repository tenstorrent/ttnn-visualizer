// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import { useCallback, useMemo, useRef, useState } from 'react';
import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/StackTrace.scss';
import { Button, ButtonGroup, Collapse, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import { isFullStackTraceAtom, reportLocationAtom } from '../../store/app';
import useRemoteConnection from '../../hooks/useRemote';
import Overlay from '../Overlay';

hljs.registerLanguage('python', python);

interface StackTraceProps {
    stackTrace: string;
}

const FILE_PATH_REGEX = /(?<=File ")(.*)(?=")/m;

function isTopOfElementInViewport(element: HTMLElement): boolean {
    const elementPosition = element.getBoundingClientRect();

    return elementPosition.top > window.scrollY;
}

function StackTrace({ stackTrace }: StackTraceProps) {
    const [isFullStackTrace, setIsFullStackTrace] = useAtom(isFullStackTraceAtom);
    // TODO: See if you can read the remote file and use setCanReadRemoteFile appropriately
    // const [canReadRemoteFile, setCanReadRemoteFile] = useState(true);
    const [filePath, setFilePath] = useState('');
    const [isFetchingFile, setIsFetchingFile] = useState(false);
    const [fileContents, setFileContents] = useState('');
    const [isViewingFile, setIsViewingFile] = useState(false);
    const toggleViewingFile = useCallback(() => setIsViewingFile((open) => !open), [setIsViewingFile]);
    const { readRemoteFile, persistentState } = useRemoteConnection();
    const connectionType = useAtomValue(reportLocationAtom);
    const scrollElementRef = useRef<null | HTMLPreElement>(null);

    // TODO: Look at how we store this as an atom vs useAppConfig localStorage
    const isRemote = connectionType === 'remote';

    const stackTraceWithHighlights = useMemo(() => {
        const matches = FILE_PATH_REGEX.exec(stackTrace);
        const highlightedString = hljs.highlight(stackTrace, { language: 'python' }).value;

        if (matches) {
            setFilePath(matches[0]);
        }

        return highlightedString;
    }, [stackTrace]);

    const fileWithHighlights = useMemo(() => {
        return fileContents ? hljs.highlight(fileContents, { language: 'python' }).value : '';
    }, [fileContents]);

    const handleReadRemoteFile = async () => {
        const { selectedConnection } = persistentState;

        if (fileContents) {
            setIsViewingFile(true);
            return;
        }

        if (selectedConnection && !fileContents && isRemote) {
            const connectionWithFilePath = {
                ...selectedConnection,
                path: filePath,
            };

            setIsFetchingFile(true);

            const response = await readRemoteFile(connectionWithFilePath);
            setFileContents(response);

            setIsFetchingFile(false);
            setIsViewingFile(true);
        }
    };

    const handleToggleStackTrace = () => {
        setIsFullStackTrace(!isFullStackTrace);

        if (isFullStackTrace && scrollElementRef?.current && !isTopOfElementInViewport(scrollElementRef.current)) {
            scrollElementRef?.current?.scrollIntoView();
        }
    };

    return (
        <pre
            className='stack-trace'
            ref={scrollElementRef}
        >
            {isFullStackTrace ? (
                <Collapse
                    isOpen={isFullStackTrace}
                    keepChildrenMounted={false}
                    className='code-wrapper'
                >
                    <code
                        className='language-python code-output'
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: stackTraceWithHighlights }}
                    />
                </Collapse>
            ) : (
                <div className='code-wrapper'>
                    <code
                        className='language-python code-output'
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{
                            __html: `  File ${stackTraceWithHighlights.split('File')[1].trim()}`,
                        }}
                    />
                </div>
            )}

            <div
                className={classNames('stack-trace-buttons', {
                    'is-sticky': isFullStackTrace,
                })}
            >
                <ButtonGroup>
                    <Tooltip
                        content={isFullStackTrace ? 'Collapse stack trace' : 'Expand stack trace'}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            type='button'
                            minimal
                            intent={Intent.PRIMARY}
                            onClick={handleToggleStackTrace}
                            className={classNames({
                                'rotate-180': isFullStackTrace,
                            })}
                            icon={isFullStackTrace ? IconNames.MINIMIZE : IconNames.MAXIMIZE}
                        />
                    </Tooltip>

                    <Tooltip
                        content={isRemote ? 'View external source file' : 'Cannot view local source file'}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            type='button'
                            minimal
                            intent={Intent.SUCCESS}
                            onClick={handleReadRemoteFile}
                            icon={IconNames.DOCUMENT_OPEN}
                            disabled={isFetchingFile || !persistentState.selectedConnection || !isRemote}
                            loading={isFetchingFile}
                        />
                    </Tooltip>
                </ButtonGroup>
            </div>

            <Overlay
                isOpen={isViewingFile}
                onClose={toggleViewingFile}
            >
                {fileWithHighlights && (
                    <pre className='stack-trace'>
                        <code
                            className='language-python code-output'
                            // eslint-disable-next-line react/no-danger
                            dangerouslySetInnerHTML={{
                                __html: fileWithHighlights,
                            }}
                        />
                    </pre>
                )}
            </Overlay>
        </pre>
    );
}

export default StackTrace;
