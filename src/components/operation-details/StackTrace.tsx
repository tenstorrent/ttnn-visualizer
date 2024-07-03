// Using ES6 import syntax
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import { useMemo, useState } from 'react';
import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/StackTrace.scss';
import { Button, Collapse, Intent } from '@blueprintjs/core';

hljs.registerLanguage('python', python);

interface StackTraceProps {
    stackTrace: string;
}

function StackTrace({ stackTrace }: StackTraceProps) {
    const [isFullStackTrace, setIsFullStackTrace] = useState(false);
    const highlightedCode = useMemo(() => hljs.highlight(stackTrace, { language: 'python' }), [stackTrace]);

    return (
        <pre className='code-output-summary'>
            <Button
                className='show-full-stack-trace bp5-button'
                type='button'
                minimal
                intent={Intent.PRIMARY}
                onClick={() => setIsFullStackTrace(!isFullStackTrace)}
            >
                Show full stack trace
            </Button>

            {isFullStackTrace ? (
                <Collapse
                    isOpen={isFullStackTrace}
                    keepChildrenMounted={false}
                >
                    <code
                        className='language-python code-output'
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: highlightedCode.value }}
                    />
                </Collapse>
            ) : (
                <code
                    className='language-python code-output'
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: `File${highlightedCode.value.split('File')[1]}` }}
                />
            )}
        </pre>
    );
}

export default StackTrace;
