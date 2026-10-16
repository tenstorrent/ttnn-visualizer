// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';

/** Marks an app surface whose clicks leave the focused buffer alone, such as the panel describing it. */
export const KEEPS_BUFFER_FOCUS_CLASS = 'keeps-buffer-focus';

// Each handles its own click, so none doubles as a dismissal: controls, the plots and canvases a
// click picks a buffer from, the toast that dismisses itself, popups, and the surfaces marked above.
const KEEPS_BUFFER_FOCUS = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    'label',
    'summary',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="slider"]',
    'canvas',
    '.js-plotly-plot',
    '.Toastify',
    // A click on a slider's track moves a handle, but only the handles carry the slider role.
    `.${Classes.SLIDER}`,
    `.${Classes.PORTAL}`,
    `.${KEEPS_BUFFER_FOCUS_CLASS}`,
].join(', ');

/** Whether a press or click on `target` lands on nothing that handles it, which dismisses the focused buffer. */
export const isBufferFocusDismissal = (target: EventTarget | null): target is Element =>
    target instanceof Element && target.closest(KEEPS_BUFFER_FOCUS) === null;

/** Whether a click on `target` ends a text selection in it: reading what was selected is not dismissing. */
export const isEndOfTextSelection = (target: Element): boolean => {
    const selection = document.getSelection();
    return selection !== null && !selection.isCollapsed && selection.getRangeAt(0).intersectsNode(target);
};
