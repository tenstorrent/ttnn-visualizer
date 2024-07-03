// Using ES6 import syntax
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import { useMemo } from 'react';
import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/StackTrace.scss';
import { Button, Collapse, Intent } from '@blueprintjs/core';
import classNames from 'classnames';

hljs.registerLanguage('python', python);

interface StackTraceProps {
    stackTrace: string;
    isFullStackTrace: boolean;
    toggleStackTraceHandler: (condition: boolean) => void;
}

function StackTrace({ stackTrace, isFullStackTrace, toggleStackTraceHandler }: StackTraceProps) {
    const stackTraceWithHighlights = useMemo(() => hljs.highlight(stackTrace, { language: 'python' }), [stackTrace]);

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
                        dangerouslySetInnerHTML={{ __html: stackTraceWithHighlights.value }}
                    />
                </Collapse>
            ) : (
                <div className='code-wrapper'>
                    <code
                        className='language-python code-output'
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{
                            __html: `  File ${stackTraceWithHighlights.value.split('File')[1].trim()}`,
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
                onClick={() => toggleStackTraceHandler(!isFullStackTrace)}
            >
                {isFullStackTrace ? 'Hide full stack trace' : 'Show full stack trace'}
            </Button>
        </pre>
    );
}

export default StackTrace;
