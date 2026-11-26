// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { Classes } from '@blueprintjs/core';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ComponentProps } from 'react';
import { Mock, afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceFileOverlay from '../src/components/operation-details/SourceFileOverlay';
import StackTrace from '../src/components/operation-details/StackTrace';
import { StackTraceLanguage } from '../src/definitions/StackTrace';
import { getCompiledStylesheet } from './helpers/compiledStylesheets';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({ persistentState: { selectedConnection: null } }),
}));

vi.mock('../src/hooks/useAPI.tsx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/hooks/useAPI.tsx')>();
    return { ...actual, useReportMetadata: () => ({ data: undefined }) };
});

const FILE_CONTENTS = Array.from({ length: 40 }, (_, index) => `value_${index + 1} = ${index + 1}`).join('\n');
const LINE_NUMBER = 30;

// Indented with spaces, and in its second function with a tab.
const INDENTED_FILE = [
    'def move(value, device):',
    '    if value is None:',
    '        return value',
    '',
    'def copy(value):',
    '\treturn value',
].join('\n');

const getLines = () => [...document.querySelectorAll('.ttnn-line')];

// What a line holds after its number, without the newline that ends it.
const getLineCode = (line: Element): string =>
    [...line.childNodes]
        .filter((node) => !(node instanceof Element && node.classList.contains('line-number')))
        .map((node) => node.textContent)
        .join('')
        .replace(/\n$/, '');

// jsdom computes `white-space` and `overflow-wrap` only where a rule sets them, its own `<pre>`
// rule included, and never inherits them, so they are read from the nearest element that sets them.
const getInheritedStyle = (element: Element, property: string): string => {
    for (let current: Element | null = element; current; current = current.parentElement) {
        const value = getComputedStyle(current).getPropertyValue(property);

        if (value) {
            return value;
        }
    }

    return '';
};

const renderOverlay = (props: Partial<ComponentProps<typeof SourceFileOverlay>> = {}) =>
    render(
        <TestProviders>
            <SourceFileOverlay
                isOpen
                onClose={() => {}}
                language={StackTraceLanguage.PYTHON}
                lineNumber={LINE_NUMBER}
                fileContents={FILE_CONTENTS}
                errorDetails=''
                resolvedPath={null}
                filePath='/m/model.py'
                matchedViaRemap={false}
                scrollToLineNumber
                {...props}
            />
        </TestProviders>,
    );

describe('SourceFileOverlay', () => {
    // jsdom has no `scrollIntoView`, so it is stubbed for these tests and put back after.
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    let scrollIntoView: Mock;

    beforeEach(() => {
        scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        // A frame that fires at once is the worst case for the first open: the overlay mounts open,
        // and Blueprint's Portal only renders its children once its own effect has created the
        // container, so the frame can fire before the file's lines are in the document.
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 0;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();

        if (originalScrollIntoView) {
            Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
        } else {
            delete (Element.prototype as Partial<Element>).scrollIntoView;
        }
    });

    const getScrolledLineNumbers = () =>
        scrollIntoView.mock.contexts.map((element) => (element as Element).textContent);

    it('scrolls to the highlighted line when it first opens', () => {
        renderOverlay();

        expect(getScrolledLineNumbers()).toEqual([`${LINE_NUMBER}`]);
    });

    it('scrolls to its own highlighted line, not another one on the page', () => {
        const stray = document.createElement('div');
        stray.className = 'highlighted-line';
        stray.innerHTML = '<span class="line-number">7</span>';
        document.body.prepend(stray);

        try {
            renderOverlay();

            expect(getScrolledLineNumbers()).toEqual([`${LINE_NUMBER}`]);
        } finally {
            stray.remove();
        }
    });

    it('scrolls again when it is closed and reopened', () => {
        const { rerender } = renderOverlay();
        const overlay = (isOpen: boolean) => (
            <TestProviders>
                <SourceFileOverlay
                    isOpen={isOpen}
                    onClose={() => {}}
                    language={StackTraceLanguage.PYTHON}
                    lineNumber={LINE_NUMBER}
                    fileContents={FILE_CONTENTS}
                    errorDetails=''
                    resolvedPath={null}
                    filePath='/m/model.py'
                    matchedViaRemap={false}
                    scrollToLineNumber
                />
            </TestProviders>
        );

        rerender(overlay(false));
        rerender(overlay(true));

        expect(getScrolledLineNumbers()).toEqual([`${LINE_NUMBER}`, `${LINE_NUMBER}`]);
    });

    it('scrolls its container to the top and bottom when it first opens', () => {
        const scrollTo = vi.fn();
        const originalScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo');
        Element.prototype.scrollTo = scrollTo;

        try {
            renderOverlay();

            fireEvent.click(document.querySelector('[data-icon="double-chevron-up"]')!.closest('button')!);
            fireEvent.click(document.querySelector('[data-icon="double-chevron-down"]')!.closest('button')!);

            expect(scrollTo).toHaveBeenCalledTimes(2);
            expect(scrollTo.mock.contexts[0]).toHaveClass('bp6-overlay-scroll-container');
            expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 0 });
        } finally {
            if (originalScrollTo) {
                Object.defineProperty(Element.prototype, 'scrollTo', originalScrollTo);
            } else {
                delete (Element.prototype as Partial<Element>).scrollTo;
            }
        }
    });

    it('keeps its controls in view as its container scrolls', () => {
        renderOverlay();
        const scrollContainer = document.querySelector(`.${Classes.OVERLAY_SCROLL_CONTAINER}`) as HTMLElement;
        const controls = document.querySelector('.source-file-controls') as HTMLElement;

        scrollContainer.scrollTop = 120;
        fireEvent.scroll(scrollContainer);
        expect(controls.style.transform).toBe('translateY(120px)');

        scrollContainer.scrollTop = 0;
        fireEvent.scroll(scrollContainer);
        expect(controls.style.transform).toBe('');
    });

    it('does not scroll on open when not asked to, but its locate button does', () => {
        renderOverlay({ scrollToLineNumber: false });

        expect(scrollIntoView).not.toHaveBeenCalled();

        // The button's only label is its tooltip, so find it by its icon.
        fireEvent.click(document.querySelector('[data-icon="locate"]')!.closest('button')!);

        expect(getScrolledLineNumbers()).toEqual([`${LINE_NUMBER}`]);
    });

    it('keeps the indentation of every line, in spaces or tabs', () => {
        renderOverlay({ fileContents: INDENTED_FILE, lineNumber: 3 });
        const lines = getLines();

        // The text keeps its whitespace whatever wraps it, so this alone can't tell whether it shows.
        expect(lines.map(getLineCode)).toEqual(INDENTED_FILE.split('\n'));
        // Without the stylesheet this only proves a `<pre>` wraps the lines: the stylesheet test
        // below checks the white-space they render with.
        lines.forEach((line) => expect(getInheritedStyle(line, 'white-space')).toMatch(/^pre/));
    });

    it('keeps the line numbers and indentation of a string that spans lines', () => {
        const docstringFile = ['def f():', '    """doc', '        indented', '    """'].join('\n');
        renderOverlay({ fileContents: docstringFile, lineNumber: 3 });
        const lines = getLines();

        expect(lines.map((line) => line.querySelector('.line-number')?.textContent)).toEqual(['1', '2', '3', '4']);
        expect(lines.map(getLineCode)).toEqual(docstringFile.split('\n'));
    });

    it.each([StackTraceLanguage.PYTHON, StackTraceLanguage.CPP])(
        'shows markup in a %s file as text, without injecting it or splitting a line',
        (language) => {
            const markupFile = ['x = "<img src=x onerror=alert(1)>"', '<div class="ttnn-line"><b>boom</b>'].join('\n');
            renderOverlay({ fileContents: markupFile, lineNumber: 1, language });

            expect(document.querySelector('.code-output img')).toBeNull();
            expect(document.querySelector('.code-output b')).toBeNull();
            expect(getLines().map(getLineCode)).toEqual(markupFile.split('\n'));
        },
    );

    describe('with its stylesheet', () => {
        const stylesheet = document.createElement('style');

        beforeAll(() => {
            stylesheet.textContent = getCompiledStylesheet('src/scss/components/StackTrace.scss');
            document.head.append(stylesheet);
        });

        afterAll(() => stylesheet.remove());

        it('sets the source viewer to keep whitespace, wrap at the edge and break long tokens', () => {
            renderOverlay({ fileContents: INDENTED_FILE, lineNumber: 3 });
            const code = document.querySelector('.code-output')!;

            // `pre-line` would collapse the indentation, and `pre` would keep a long line on one row.
            getLines().forEach((line) =>
                expect(getInheritedStyle(line, 'white-space')).toMatch(/^(pre-wrap|break-spaces)$/),
            );
            expect(['', 'wrap']).toContain(getInheritedStyle(code, 'text-wrap'));
            expect(getInheritedStyle(code, 'overflow-wrap')).toBe('anywhere');
        });

        it("leaves the stack trace's balanced wrap as it was", () => {
            render(
                <StackTrace
                    stackTrace={'  File "/m/model.py", line 3, in move\n    return value'}
                    language={StackTraceLanguage.PYTHON}
                    hideSourceButton
                />,
            );
            const code = document.querySelector('.code-output')!;

            expect(getComputedStyle(code).getPropertyValue('text-wrap')).toBe('balance');
            expect(getInheritedStyle(code, 'white-space')).toBe('pre');
            expect(getInheritedStyle(code, 'overflow-wrap')).toBe('');
        });
    });
});
