// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';
import { fireEvent, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Passes once a Blueprint popover is open. A portal alone is not enough: Blueprint 6.21's selects
 * render their popover eagerly, so every closed select already leaves an empty portal in the page.
 */
const testForPortal = () => {
    const openPopover = document.querySelector(`.${Classes.PORTAL} .${Classes.OVERLAY_OPEN} .${Classes.POPOVER}`);
    expect(openPopover).not.toBeNull();
};

/**
 * Opens the popover a trigger controls and waits until it is open. Some popovers stay open after an
 * action inside them, and clicking the trigger again would close them, so this only clicks when the
 * trigger reports its popover closed.
 */
export const openPopover = async (trigger: HTMLElement, options?: Parameters<typeof waitFor>[1]) => {
    if (trigger.closest('[aria-expanded]')?.getAttribute('aria-expanded') !== 'true') {
        fireEvent.click(trigger);
    }

    await waitFor(testForPortal, options);
};

export default testForPortal;
