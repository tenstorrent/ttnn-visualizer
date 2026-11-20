// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Placement, PopperCustomModifier } from '@blueprintjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POPOVER_ROOM_PROPERTY, fitPopoverToWindow } from '../src/functions/fitPopoverToWindow';

const WINDOW_HEIGHT = 900;
const TRIGGER_HEIGHT = 24;
const ARROW_GAP = 15;
const WINDOW_MARGIN = 8;

type ModifierArguments = Parameters<NonNullable<PopperCustomModifier['fn']>>[0];

const fit = (triggerTop: number, placement: Placement = 'bottom-start') => {
    const state = {
        elements: {
            reference: { getBoundingClientRect: () => ({ top: triggerTop, bottom: triggerTop + TRIGGER_HEIGHT }) },
            popper: document.createElement('div'),
        },
        placement,
        reset: false,
        modifiersData: {
            offset: { 'bottom-start': { x: 0, y: ARROW_GAP }, 'top-start': { x: 0, y: -ARROW_GAP } },
        },
    };
    fitPopoverToWindow.fn?.({ state, options: {}, name: 'fitPopoverToWindow' } as unknown as ModifierArguments);

    return { ...state, room: state.elements.popper.style.getPropertyValue(POPOVER_ROOM_PROPERTY) };
};

describe('fitPopoverToWindow', () => {
    beforeEach(() => vi.stubGlobal('innerHeight', WINDOW_HEIGHT));
    afterEach(() => vi.unstubAllGlobals());

    it('opens below a trigger in the top half of the window, no taller than the room under it', () => {
        const triggerTop = 100;
        const fitted = fit(triggerTop);

        expect(fitted.placement).toBe('bottom-start');
        expect(fitted.reset).toBe(false);
        expect(fitted.room).toBe(`${WINDOW_HEIGHT - triggerTop - TRIGGER_HEIGHT - ARROW_GAP - WINDOW_MARGIN}px`);
    });

    // A popover too tall for either side must not fall back below a trigger low in the window.
    it('opens above a trigger in the bottom half of the window, no taller than the room over it', () => {
        const triggerTop = 494;
        const moved = fit(triggerTop);

        expect(moved.placement).toBe('top-start');
        expect(moved.reset).toBe(true);

        const fitted = fit(triggerTop, 'top-start');

        expect(fitted.reset).toBe(false);
        expect(fitted.room).toBe(`${triggerTop - ARROW_GAP - WINDOW_MARGIN}px`);
    });
});
