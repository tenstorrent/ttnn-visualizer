// Using ES6 import syntax
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import { ButtonHTMLAttributes, HTMLAttributes, useMemo, useRef } from 'react';
import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/StackTrace.scss';
import { Button } from '@blueprintjs/core';

// Then register the languages you need
hljs.registerLanguage('python', python);

interface StackTraceProps {
    stackTrace: string;
}

type PopoverButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    popovertarget: string;
};

type PopoverDivProps = HTMLAttributes<HTMLDivElement> & {
    popover: boolean;
    id: string;
};

function StackTrace({ stackTrace }: StackTraceProps) {
    const popoverRef = useRef(null);
    const highlightedCode = useMemo(() => hljs.highlight(stackTrace, { language: 'python' }), [stackTrace]);

    const handlePopoverReveal = () => {
        if (popoverRef?.current) {
            const el: HTMLElement = popoverRef.current;
            el.togglePopover();
        }
    };

    return (
        <>
            <Button className='bp5-button' type='button' onClick={handlePopoverReveal}>
                View stack trace
            </Button>
            <div id='wave' popover='' ref={popoverRef}>
                <pre>
                    <code
                        className='language-python'
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: highlightedCode.value }}
                    />
                </pre>
            </div>
        </>
    );
}

export default StackTrace;
