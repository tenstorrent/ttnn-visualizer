// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ComponentProps } from 'react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceFileOverlay from '../src/components/operation-details/SourceFileOverlay';
import { StackTraceLanguage } from '../src/definitions/StackTrace';
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

    it('does not scroll on open when not asked to, but its locate button does', () => {
        renderOverlay({ scrollToLineNumber: false });

        expect(scrollIntoView).not.toHaveBeenCalled();

        // The button's only label is its tooltip, so find it by its icon.
        fireEvent.click(document.querySelector('[data-icon="locate"]')!.closest('button')!);

        expect(getScrolledLineNumbers()).toEqual([`${LINE_NUMBER}`]);
    });
});
