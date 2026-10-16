// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Each handles its own click, so none doubles as a dismissal: controls, the plots and canvases a
// click picks a buffer from, the toast that dismisses itself, and popups portalled off the page.
const HANDLES_ITS_OWN_CLICK = [
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
    '.bp6-portal',
].join(', ');

/** Whether a click landed on nothing that handles it, which is what dismisses a focused buffer. */
const isClickAway = (event: MouseEvent): boolean => {
    const { target } = event;
    if (!(target instanceof Element) || target.closest(HANDLES_ITS_OWN_CLICK) !== null) {
        return false;
    }
    // A drag that selects text ends in a click on what it selected, and reading is not dismissing.
    const selection = document.getSelection();
    return selection === null || selection.isCollapsed || !selection.getRangeAt(0).intersectsNode(target);
};

export default isClickAway;
