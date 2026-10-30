// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * A `ResizeObserver` stand-in that records what it observes, so a spec can report a size for an element when it
 * chooses. jsdom has no layout, so nothing reports a size otherwise. Install it with `installCapturingResizeObserver`.
 */
export class CapturingResizeObserver {
    static instances: CapturingResizeObserver[] = [];

    readonly observed = new Set<Element>();

    readonly disconnect = vi.fn(() => this.observed.clear());

    constructor(private readonly callback: ResizeObserverCallback) {
        CapturingResizeObserver.instances.push(this);
    }

    observe(element: Element) {
        this.observed.add(element);
    }

    unobserve(element: Element) {
        this.observed.delete(element);
    }

    /** Reports a new content width for every observed element, as the browser would after layout. */
    report(width: number) {
        const entries = [...this.observed].map((target) => ({ target, contentRect: { width } }));

        act(() => this.callback(entries as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver));
    }
}

/** The live observer watching this element; the spec fails clearly if there is none. */
export const getObserverFor = (element: Element) => {
    const observer = CapturingResizeObserver.instances.find((instance) => instance.observed.has(element));

    if (!observer) {
        throw new Error('No ResizeObserver is observing this element');
    }

    return observer;
};

/** Replaces `ResizeObserver` for the current spec; undo with `vi.unstubAllGlobals()`. */
export const installCapturingResizeObserver = () => {
    CapturingResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', CapturingResizeObserver);
};
