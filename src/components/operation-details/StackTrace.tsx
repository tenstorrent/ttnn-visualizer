// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import { useMemo } from 'react';
import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/StackTrace.scss';
import { Button, Collapse, Intent } from '@blueprintjs/core';
import classNames from 'classnames';
import { useAtom } from 'jotai';
import { isFullStackTraceAtom } from '../../store/app';

hljs.registerLanguage('python', python);

interface StackTraceProps {
    stackTrace: string;
}

function StackTrace({ stackTrace }: StackTraceProps) {
    const [isFullStackTrace, setIsFullStackTrace] = useAtom(isFullStackTraceAtom);
    const stackTraceWithHighlights = useMemo(() => {
        const regex = /(?<=File <span class="hljs-string">&quot;)(.*)(?=&quot;<\/span>,)/m;
        const highlightedString = hljs.highlight(stackTrace, { language: 'python' }).value;
        const matches = regex.exec(highlightedString);

        return matches
            ? highlightedString.replace(regex, `<a href="/" class="file-explorer" target="_blank">${matches[0]}</a>`)
            : highlightedString;
    }, [stackTrace]);
    // const { readRemoteFile } = useRemoteConnection();

    if (!stackTrace) {
        return null;
    }

    const parts = stackTrace.trimStart().split(' ');
    const file = parts[1];
    console.info(`Attempting to read file: ${file}`);

    // readRemoteFile({
    //     path: file,
    //     host: 'THE_REMOTE_HOST',
    //     port: 2222,
    //     name: '',
    //     username: 'YOUR_USER_NAME',
    // })
    //     .then((value) => {
    //         console.info(value);
    //         return value;
    //     })
    //     .catch((err) => {
    //         if (axios.isAxiosError(err)) {
    //             console.error(err.message);
    //         }
    //     });

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

            <Button
                className={classNames({
                    'is-sticky': isFullStackTrace,
                })}
                type='button'
                minimal
                intent={Intent.PRIMARY}
                onClick={() => setIsFullStackTrace(!isFullStackTrace)}
            >
                {isFullStackTrace ? 'Hide full stack trace' : 'Show full stack trace'}
            </Button>
        </pre>
    );
}

export default StackTrace;
