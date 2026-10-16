// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { type ReactNode } from 'react';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
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

const mount = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    return host;
};

afterEach(() => {
    cleanup();
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
});

describe('useBufferFocusDismissal', () => {
    it('dismisses the focused buffer on a click pressed and released on content', () => {
        renderFocused();
        const host = mount('<h3 id="heading">L1</h3>');

        pressAndRelease(host.querySelector('#heading')!);

        expect(bufferFocus()).toHaveTextContent('dismissed');
    });

    it('keeps it through a click on a control', () => {
        renderFocused();
        const host = mount('<button id="control">L1 Memory</button>');

        pressAndRelease(host.querySelector('#control')!);

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('keeps it when a press on a control is released elsewhere', () => {
        renderFocused();
        const host = mount('<button id="control">L1 Memory</button><h3 id="heading">L1</h3>');

        fireEvent.pointerDown(host.querySelector('#control')!);
        fireEvent.click(host.querySelector('#heading')!);

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('keeps it when a press in a plot is released outside it', () => {
        // Plotly covers the page while a press is down, so a browser can deliver the release elsewhere.
        renderFocused();
        const host = mount('<div class="js-plotly-plot"><svg><rect id="bar" /></svg></div>');

        fireEvent.pointerDown(host.querySelector('#bar')!);
        fireEvent.click(document.body);

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('keeps it when the click ends a text selection in what it clicked', () => {
        renderFocused();
        const host = mount('<p id="text">MemoryLayout BLOCK_SHARDED</p>');
        const range = document.createRange();
        range.selectNodeContents(host.querySelector('#text')!);
        document.getSelection()?.addRange(range);

        pressAndRelease(host.querySelector('#text')!);

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('forgets a press once its click is judged, so a later click with no press keeps it', () => {
        // A keyboard or a script clicks without pressing, and a stale press must not stand in.
        renderFocused();
        const host = mount('<h3 id="heading">L1</h3><button id="control">L1 Memory</button>');

        fireEvent.pointerDown(host.querySelector('#heading')!);
        fireEvent.click(host.querySelector('#control')!);
        fireEvent.click(host.querySelector('#heading')!);

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('dismisses a focus on a tensor with no address', () => {
        renderFocused([[selectedTensorIdAtom, TENSOR_ID]]);
        const host = mount('<h3 id="heading">Inputs</h3>');

        pressAndRelease(host.querySelector('#heading')!);

        expect(bufferFocus()).toHaveTextContent('dismissed');
    });

    it('dismisses a focus on a buffer at address 0', () => {
        renderFocused([[selectedAddressAtom, 0]]);
        const host = mount('<h3 id="heading">DRAM</h3>');

        pressAndRelease(host.querySelector('#heading')!);

        expect(bufferFocus()).toHaveTextContent('dismissed');
    });

    it('judges a press before the handler it lands on can re-render it', () => {
        // A button that swaps its icon on press would otherwise leave the pressed node in no button.
        renderFocused();
        const host = mount('<button id="toggle"><svg id="icon"><path id="hit" /></svg></button>');
        const toggle = host.querySelector('#toggle')!;
        toggle.addEventListener('pointerdown', () => toggle.replaceChildren());

        fireEvent.pointerDown(host.querySelector('#hit')!);
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
