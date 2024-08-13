// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import { useCallback, useMemo, useState } from 'react';
import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/StackTrace.scss';
import { Button, Collapse, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useAtom } from 'jotai';
import { isFullStackTraceAtom } from '../../store/app';
import useRemoteConnection from '../../hooks/useRemote';
import Overlay from '../Overlay';

hljs.registerLanguage('python', python);

interface StackTraceProps {
    stackTrace: string;
}

const FILE_PATH_REGEX = /(?<=File ")(.*)(?=")/m;

function StackTrace({ stackTrace }: StackTraceProps) {
    const [isFullStackTrace, setIsFullStackTrace] = useAtom(isFullStackTraceAtom);
    // TODO: Include check for whether the remote file exists or not
    const [canReadRemoteFile, _setCanReadRemoteFile] = useState(true);
    const [filePath, setFilePath] = useState('');
    const [isFetchingFile, setIsFetchingFile] = useState(false);
    const [fileContents, setFileContents] = useState('');
    const [isViewingFile, setIsViewingFile] = useState(false);
    const toggleViewingFile = useCallback(() => setIsViewingFile((open) => !open), [setIsViewingFile]);
    const { readRemoteFile } = useRemoteConnection();

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
        const selectedConnection = localStorage.getItem('selectedConnection');

        if (fileContents) {
            setIsViewingFile(true);
            return;
        }

        if (selectedConnection && !fileContents) {
            const connectionWithFilePath = {
                ...JSON.parse(selectedConnection),
                path: filePath,
            };

            setIsFetchingFile(true);

            try {
                const response = await readRemoteFile(connectionWithFilePath);

                if (response?.status === 200) {
                    setFileContents(response.data);
                } else {
                    setFileContents(
                        'Error reading file. Either the file is not available or the connection is not valid.',
                    );
                }
            } catch (error) {
                setFileContents('Error reading file. Either the file is not available or the connection is not valid.');
            }

            setIsFetchingFile(false);
            setIsViewingFile(true);
        }
    };

    // TODO: See if you can read the remote file and use setCanReadRemoteFile appropriately

    return (
        <pre className='stack-trace'>
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
                <Button
                    type='button'
                    minimal
                    intent={Intent.PRIMARY}
                    onClick={() => setIsFullStackTrace(!isFullStackTrace)}
                >
                    {isFullStackTrace ? 'Hide full stack trace' : 'Show full stack trace'}
                </Button>

                {canReadRemoteFile && (
                    <Button
                        type='button'
                        minimal
                        intent={Intent.SUCCESS}
                        onClick={handleReadRemoteFile}
                        rightIcon={IconNames.DOCUMENT_OPEN}
                        disabled={isFetchingFile}
                    >
                        Read remote file
                    </Button>
                )}
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
