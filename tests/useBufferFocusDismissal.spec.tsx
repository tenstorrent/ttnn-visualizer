// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { type ReactNode } from 'react';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useBufferFocusDismissal from '../src/hooks/useBufferFocusDismissal';
import { selectedAddressAtom, selectedTensorIdAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import { BufferFocusProbe } from './helpers/BufferFocusProbe';
import { bufferFocus, pressAndRelease } from './helpers/bufferFocus';
import type { AtomProviderInitialValues } from './helpers/atomProvider';

const ADDRESS = 0x4000;
const TENSOR_ID = 10;

const renderFocused = (
    focus: AtomProviderInitialValues = [
        [selectedAddressAtom, ADDRESS],
        [selectedTensorIdAtom, TENSOR_ID],
    ],
) =>
    renderHook(() => useBufferFocusDismissal(), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <TestProviders initialAtomValues={focus}>
                {children}
                <BufferFocusProbe />
            </TestProviders>
        ),
    });

afterEach(() => {
    cleanup();
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
});

describe('useBufferFocusDismissal', () => {
    it('dismisses the focused buffer on a click pressed and released on content', () => {
        renderFocused();
        render(<h3>L1</h3>);

        pressAndRelease(screen.getByRole('heading', { name: 'L1' }));

        expect(bufferFocus()).toHaveTextContent('dismissed');
    });

    it('keeps it through a click on a control', () => {
        renderFocused();
        render(<button type='button'>L1 Memory</button>);

        pressAndRelease(screen.getByRole('button', { name: 'L1 Memory' }));

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('keeps it when a press on a control is released elsewhere', () => {
        renderFocused();
        render(
            <>
                <button type='button'>L1 Memory</button>
                <h3>L1</h3>
            </>,
        );

        fireEvent.pointerDown(screen.getByRole('button', { name: 'L1 Memory' }));
        fireEvent.click(screen.getByRole('heading', { name: 'L1' }));

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('keeps it when a press in a plot is released outside it', () => {
        // Plotly covers the page while a press is down, so a browser can deliver the release elsewhere.
        renderFocused();
        render(
            <div className='js-plotly-plot'>
                <svg>
                    <rect data-testid='bar' />
                </svg>
            </div>,
        );

        fireEvent.pointerDown(screen.getByTestId('bar'));
        fireEvent.click(document.body);

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('keeps it when the click ends a text selection in what it clicked', () => {
        renderFocused();
        render(<p>MemoryLayout BLOCK_SHARDED</p>);
        const text = screen.getByText('MemoryLayout BLOCK_SHARDED');
        const range = document.createRange();
        range.selectNodeContents(text);
        document.getSelection()?.addRange(range);

        pressAndRelease(text);

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('forgets a press once its click is judged, so a later click with no press keeps it', () => {
        // A keyboard or a script clicks without pressing, and a stale press must not stand in.
        renderFocused();
        render(
            <>
                <h3>L1</h3>
                <button type='button'>L1 Memory</button>
            </>,
        );
        const heading = screen.getByRole('heading', { name: 'L1' });

        fireEvent.pointerDown(heading);
        fireEvent.click(screen.getByRole('button', { name: 'L1 Memory' }));
        fireEvent.click(heading);

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('dismisses a focus on a tensor with no address', () => {
        renderFocused([[selectedTensorIdAtom, TENSOR_ID]]);
        render(<h3>Inputs</h3>);

        pressAndRelease(screen.getByRole('heading', { name: 'Inputs' }));

        expect(bufferFocus()).toHaveTextContent('dismissed');
    });

    it('dismisses a focus on a buffer at address 0', () => {
        renderFocused([[selectedAddressAtom, 0]]);
        render(<h3>DRAM</h3>);

        pressAndRelease(screen.getByRole('heading', { name: 'DRAM' }));

        expect(bufferFocus()).toHaveTextContent('dismissed');
    });

    it('judges a press before the handler it lands on can re-render it', () => {
        // A button that swaps its icon on press would otherwise leave the pressed node in no button.
        renderFocused();
        render(
            <button type='button'>
                <svg>
                    <path data-testid='icon' />
                </svg>
            </button>,
        );
        const toggle = screen.getByRole('button');
        toggle.addEventListener('pointerdown', () => toggle.replaceChildren());

        fireEvent.pointerDown(screen.getByTestId('icon'));
        fireEvent.click(document.body);

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('listens only while a buffer is focused, and not after unmounting', () => {
        const addListener = vi.spyOn(document, 'addEventListener');
        const removeListener = vi.spyOn(document, 'removeEventListener');
        const listensFor = (spy: typeof addListener) =>
            spy.mock.calls.map(([type]) => type).filter((type) => type === 'click');

        renderFocused([]).unmount();
        expect(listensFor(addListener)).toEqual([]);

        renderFocused().unmount();
        expect(listensFor(addListener)).toEqual(['click']);
        expect(listensFor(removeListener)).toEqual(['click']);
    });
});
