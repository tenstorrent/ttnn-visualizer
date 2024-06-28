// Using ES6 import syntax
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import { useEffect, useMemo } from 'react';
import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/StackTrace.scss';

// Then register the languages you need
hljs.registerLanguage('python', python);

interface StackTraceProps {
    stackTrace: string;
}

function StackTrace({ stackTrace }: StackTraceProps) {
    const highlightedCode = useMemo(() => hljs.highlight(stackTrace, { language: 'python' }), [stackTrace]);

    useEffect(() => {
        hljs.highlightAll();
    }, []);

    return (
        // <>
        //     <button className='bp5-button' type='button' popovertarget='wave'>
        //         View stack trace
        //     </button>
        <pre id='wave='>
            <code className='language-python' dangerouslySetInnerHTML={{ __html: highlightedCode.value }} />
        </pre>
        // </>
    );
}

export default StackTrace;
