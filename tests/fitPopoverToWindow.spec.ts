// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Placement, PopperCustomModifier } from '@blueprintjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ABOVE_TRIGGER,
    BELOW_TRIGGER,
    POPOVER_ROOM_PROPERTY,
    WINDOW_MARGIN,
    fitPopoverToWindow,
} from '../src/functions/fitPopoverToWindow';

const WINDOW_HEIGHT = 900;
const TRIGGER_HEIGHT = 24;
const ARROW_GAP = 15;

const ARROW_OFFSETS = { [BELOW_TRIGGER]: { x: 0, y: ARROW_GAP }, [ABOVE_TRIGGER]: { x: 0, y: -ARROW_GAP } };

type ModifierArguments = Parameters<NonNullable<PopperCustomModifier['fn']>>[0];

const fit = (
    triggerTop: number,
    placement: Placement = BELOW_TRIGGER,
    offsets: typeof ARROW_OFFSETS | null = ARROW_OFFSETS,
) => {
    const state = {
        elements: {
            reference: { getBoundingClientRect: () => ({ top: triggerTop, bottom: triggerTop + TRIGGER_HEIGHT }) },
            popper: document.createElement('div'),
        },
        placement,
        reset: false,
        modifiersData: offsets ? { offset: offsets } : {},
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

        expect(fitted.placement).toBe(BELOW_TRIGGER);
        expect(fitted.reset).toBe(false);
        expect(fitted.room).toBe(`${WINDOW_HEIGHT - triggerTop - TRIGGER_HEIGHT - ARROW_GAP - WINDOW_MARGIN}px`);
    });

    // A popover too tall for either side must not fall back below a trigger low in the window.
    it('opens above a trigger in the bottom half of the window, no taller than the room over it', () => {
        const triggerTop = 494;
        const moved = fit(triggerTop);

        expect(moved.placement).toBe(ABOVE_TRIGGER);
        expect(moved.reset).toBe(true);

        const fitted = fit(triggerTop, ABOVE_TRIGGER);

        expect(fitted.reset).toBe(false);
        expect(fitted.room).toBe(`${triggerTop - ARROW_GAP - WINDOW_MARGIN}px`);
    });

    it('goes back below its trigger once the trigger is in the top half again, sizing nothing until then', () => {
        const moved = fit(100, ABOVE_TRIGGER);

        expect(moved.placement).toBe(BELOW_TRIGGER);
        expect(moved.reset).toBe(true);
        expect(moved.room).toBe('');
    });

    it('opens below a trigger with as much room under it as over it', () => {
        const triggerTop = (WINDOW_HEIGHT - TRIGGER_HEIGHT) / 2;
        const fitted = fit(triggerTop);

        expect(fitted.placement).toBe(BELOW_TRIGGER);
        expect(fitted.reset).toBe(false);
        expect(fitted.room).toBe(`${triggerTop - ARROW_GAP - WINDOW_MARGIN}px`);
    });

    it('leaves no gap for an arrow when the popover has no offset', () => {
        const triggerTop = 100;
        const fitted = fit(triggerTop, BELOW_TRIGGER, null);

        expect(fitted.room).toBe(`${WINDOW_HEIGHT - triggerTop - TRIGGER_HEIGHT - WINDOW_MARGIN}px`);
    });
});
