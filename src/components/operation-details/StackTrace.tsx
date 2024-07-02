// Using ES6 import syntax
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import { useMemo, useRef } from 'react';
import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/StackTrace.scss';
import { Button, Intent } from '@blueprintjs/core';

// Then register the languages you need
hljs.registerLanguage('python', python);

interface StackTraceProps {
    stackTrace: string;
}

function StackTrace({ stackTrace }: StackTraceProps) {
    const popoverRef = useRef(null);
    const highlightedCode = useMemo(() => hljs.highlight(stackTrace, { language: 'python' }), [stackTrace]);

    const handlePopoverReveal = () => {
        if (popoverRef?.current) {
            const el: HTMLElement = popoverRef.current;
            el.togglePopover();
        }
    };

    console.log(highlightedCode.value);

    return (
        <>
            <pre className='code-output-summary'>
                <code
                    className='language-python code-output'
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: `File${highlightedCode.value.split('File')[1]}` }}
                />

                <Button
                    className='bp5-button'
                    type='button'
                    onClick={handlePopoverReveal}
                    minimal
                    intent={Intent.PRIMARY}
                >
                    Show full stack trace
                </Button>
            </pre>

            <div
                id='wave'
                popover=''
                ref={popoverRef}
            >
                <pre>
                    <code
                        className='language-python code-output'
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: highlightedCode.value }}
                    />
                </pre>
            </div>
        </>
    );
}

export default StackTrace;
