// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Placement, PopperCustomModifier } from '@blueprintjs/core';

export const BELOW_TRIGGER: Placement = 'bottom-start';
export const ABOVE_TRIGGER: Placement = 'top-start';
export const WINDOW_MARGIN = 8;
// A popover's stylesheet caps its content's height with this, so the content scrolls rather than leaving the window.
export const POPOVER_ROOM_PROPERTY = '--popover-room';

/** Opens a popover on the side of its trigger with more room, and sets that room as `--popover-room`. */
export const fitPopoverToWindow: PopperCustomModifier = {
    name: 'fitPopoverToWindow',
    enabled: true,
    phase: 'main',
    requiresIfExists: ['offset'],
    fn: ({ state }) => {
        const trigger = state.elements.reference.getBoundingClientRect();
        const roomBelow = window.innerHeight - trigger.bottom;
        const placement = roomBelow >= trigger.top ? BELOW_TRIGGER : ABOVE_TRIGGER;

        if (state.placement !== placement) {
            state.placement = placement;
            state.reset = true;
            return;
        }

        const gap = Math.abs(state.modifiersData.offset?.[placement]?.y ?? 0);
        const room = Math.max(roomBelow, trigger.top) - gap - WINDOW_MARGIN;
        state.elements.popper.style.setProperty(POPOVER_ROOM_PROPERTY, `${room}px`);
    },
};
