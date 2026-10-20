// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { type ReactNode } from 'react';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useBufferFocusDismissal from '../src/hooks/useBufferFocusDismissal';
import { dismissToast } from '../src/functions/createToastNotification';
import { selectedAddressAtom, selectedBufferColourAtom, selectedTensorIdAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import { BufferFocusProbe } from './helpers/BufferFocusProbe';
import { getBufferFocusProbe, pressAndRelease, selectContents } from './helpers/bufferFocus';
import type { AtomProviderInitialValues } from './helpers/atomProvider';

vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock();
});

const ADDRESS = 0x4000;
const TENSOR_ID = 10;
const COLOUR = '#4e79a7';
const DISMISSAL_EVENTS = ['click', 'pointercancel', 'pointerdown'];

const renderFocused = (
    focus: AtomProviderInitialValues = [
        [selectedAddressAtom, ADDRESS],
        [selectedTensorIdAtom, TENSOR_ID],
        [selectedBufferColourAtom, COLOUR],
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
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cleanup();
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
});

describe('useBufferFocusDismissal', () => {
    it('dismisses the focused buffer, its colour and its toast on a click pressed and released on content', () => {
        renderFocused();
        render(<h3>L1</h3>);

        pressAndRelease(screen.getByRole('heading', { name: 'L1' }));

        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
        expect(dismissToast).toHaveBeenCalledExactlyOnceWith();
    });

    it('keeps it through a click on a control', () => {
        renderFocused();
        render(<button type='button'>L1 Memory</button>);

        pressAndRelease(screen.getByRole('button', { name: 'L1 Memory' }));

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    // Pressed on one and released on the other, a browser sends the click to their common ancestor.
    const renderControlBesideContent = () =>
        render(
            <div data-testid='both'>
                <button type='button'>L1 Memory</button>
                <h3>L1</h3>
            </div>,
        );

    it('keeps it when a press on a control is released elsewhere', () => {
        renderFocused();
        renderControlBesideContent();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'L1 Memory' }));
        fireEvent.click(screen.getByTestId('both'));

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('dismisses it for a drag from content onto a control', () => {
        renderFocused();
        renderControlBesideContent();

        fireEvent.pointerDown(screen.getByRole('heading', { name: 'L1' }));
        fireEvent.click(screen.getByTestId('both'));

        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
    });

    it('keeps it through a click with no press, as a keyboard or a script makes one', () => {
        renderFocused();
        render(<h3>L1</h3>);

        fireEvent.click(screen.getByRole('heading', { name: 'L1' }));

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
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

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('keeps it when the click ends a text selection in what it clicked', () => {
        renderFocused();
        render(<p>MemoryLayout BLOCK_SHARDED</p>);
        const text = screen.getByText('MemoryLayout BLOCK_SHARDED');
        selectContents(text);

        pressAndRelease(text);

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('forgets a press once its click is judged, so a later click with no press keeps it', () => {
        // A drag-select's press is spent on its own click, which keeps the focus; a script's later
        // click on the same text has no press of its own, and the spent one must not stand in.
        renderFocused();
        render(<p>MemoryLayout BLOCK_SHARDED</p>);
        const text = screen.getByText('MemoryLayout BLOCK_SHARDED');
        selectContents(text);
        pressAndRelease(text);
        document.getSelection()?.removeAllRanges();

        fireEvent.click(text);

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('forgets a press the browser cancels, so a later click with no press keeps it', () => {
        renderFocused();
        render(<h3>L1</h3>);
        const heading = screen.getByRole('heading', { name: 'L1' });
        fireEvent.pointerDown(heading);
        fireEvent.pointerCancel(heading);

        fireEvent.click(heading);

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('dismisses a focus on a tensor with no address', () => {
        renderFocused([[selectedTensorIdAtom, TENSOR_ID]]);
        render(<h3>Inputs</h3>);

        pressAndRelease(screen.getByRole('heading', { name: 'Inputs' }));

        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
    });

    it('dismisses a focus on a buffer at address 0', () => {
        renderFocused([[selectedAddressAtom, 0]]);
        render(<h3>DRAM</h3>);

        pressAndRelease(screen.getByRole('heading', { name: 'DRAM' }));

        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
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

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('listens in the capture phase only while a buffer is focused, and not after unmounting', () => {
        const addListener = vi.spyOn(document, 'addEventListener');
        const removeListener = vi.spyOn(document, 'removeEventListener');
        const isCapture = (options: boolean | EventListenerOptions | undefined) =>
            options === true || (typeof options === 'object' && options.capture === true);
        const captured = (spy: typeof addListener) =>
            spy.mock.calls
                .filter(([type, , options]) => DISMISSAL_EVENTS.includes(type) && isCapture(options))
                .map(([type]) => type)
                .sort();

        renderFocused([]).unmount();
        expect(captured(addListener)).toEqual([]);

        renderFocused().unmount();
        expect(captured(addListener)).toEqual(DISMISSAL_EVENTS);
        expect(captured(removeListener)).toEqual(DISMISSAL_EVENTS);
    });
});
