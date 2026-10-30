// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';
import { fireEvent, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Passes once a Blueprint popover is open. A portal alone is not enough: `@blueprintjs/select` 6.4's
 * selects render their popover eagerly, so every closed select already leaves an empty portal in the page.
 */
const testForPortal = () => {
    const openPopover = document.querySelector(`.${Classes.PORTAL} .${Classes.OVERLAY_OPEN} .${Classes.POPOVER}`);
    expect(openPopover).not.toBeNull();
};

/**
 * The element that reports whether the trigger's popover is open. `PopoverNext` (selects) puts `aria-expanded` on
 * its target wrapper, while the classic `Popover` puts it on the element it wraps. Hover popovers such as tooltips
 * leave it unset, so a tooltip wrapped round the trigger is skipped, and an unrelated expanded ancestor such as a
 * tree node never matches because it is not a popover target or its child.
 */
const findExpandableTarget = (trigger: HTMLElement) => {
    for (let element: HTMLElement | null = trigger; element; element = element.parentElement) {
        const isTargetOrChild =
            element.classList.contains(Classes.POPOVER_TARGET) ||
            element.parentElement?.classList.contains(Classes.POPOVER_TARGET);

        if (isTargetOrChild && element.hasAttribute('aria-expanded')) {
            return element;
        }
    }

    return null;
};

/**
 * Opens the Blueprint popover a trigger controls and waits until that popover reports itself open. The trigger
 * can be any element inside the popover's target, such as a button or a select's input.
 *
 * Some popovers stay open after an action inside them, and clicking the trigger again would close them, so this
 * only clicks when the target reports its popover closed. It waits on the target's own `aria-expanded` rather
 * than on any open popover in the page, which a tooltip or another overlay could satisfy.
 */
export const openPopover = async (trigger: HTMLElement, options?: Parameters<typeof waitFor>[1]) => {
    const target = findExpandableTarget(trigger);

    expect(target, 'the trigger is not inside a Blueprint popover target').not.toBeNull();

    if (target!.getAttribute('aria-expanded') !== 'true') {
        fireEvent.click(trigger);
    }

    await waitFor(() => expect(target).toHaveAttribute('aria-expanded', 'true'), options);
};

export default testForPortal;
