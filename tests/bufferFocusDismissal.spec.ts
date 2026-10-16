// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
    KEEPS_BUFFER_FOCUS_CLASS,
    isBufferFocusDismissal,
    isEndOfTextSelection,
} from '../src/functions/bufferFocusDismissal';

const mount = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    return host;
};

const select = (range: Range) => {
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
};

afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
});

describe('isBufferFocusDismissal', () => {
    it('dismisses on plain content', () => {
        const host = mount('<table><tr><td id="cell">BLOCK_SHARDED</td></tr></table><h3 id="heading">L1</h3>');

        expect(isBufferFocusDismissal(host.querySelector('#cell'))).toBe(true);
        expect(isBufferFocusDismissal(host.querySelector('#heading'))).toBe(true);
        expect(isBufferFocusDismissal(host)).toBe(true);
    });

    it.each([
        ['a button, through its icon', '<button><svg><path id="hit" /></svg></button>'],
        ['a link', '<a href="#x"><span id="hit">link</span></a>'],
        ['an input', '<input id="hit" />'],
        ['a select', '<select id="hit"></select>'],
        ['a text area', '<textarea id="hit"></textarea>'],
        ['a label', '<label id="hit">Buffer zoom</label>'],
        ['a disclosure summary', '<details><summary id="hit">More</summary></details>'],
        ['editable text', '<div contenteditable="true"><span id="hit">note</span></div>'],
        ['a role button', '<div role="button"><span id="hit">Deselect</span></div>'],
        ['a role link', '<span role="link" id="hit">source</span>'],
        ['a checkbox', '<div role="checkbox" id="hit"></div>'],
        ['a radio', '<div role="radio" id="hit"></div>'],
        ['a tab', '<div role="tab"><span id="hit">L1</span></div>'],
        ['a switch', '<div role="switch" id="hit"></div>'],
        ['a menu item', '<li role="menuitem"><span id="hit">Copy</span></li>'],
        ['an option', '<li role="option" id="hit">Top 10</li>'],
        ['a slider handle', '<span role="slider" id="hit"></span>'],
        ['anything tabbable', '<div tabindex="0"><span id="hit">cell</span></div>'],
        ['a slider track, which moves a handle', `<div class="${Classes.SLIDER}"><div id="hit"></div></div>`],
        ['a canvas a click picks a buffer from', '<canvas id="hit"></canvas>'],
        ['a plot', '<div class="js-plotly-plot"><svg><rect id="hit" /></svg></div>'],
        ['the toast, which dismisses itself', '<section class="Toastify"><div id="hit">Tensor 3</div></section>'],
        ['a portalled popup', `<div class="${Classes.PORTAL}"><p id="hit">tooltip</p></div>`],
        ['a surface marked to keep it', `<aside class="${KEEPS_BUFFER_FOCUS_CLASS}"><h3 id="hit">Tensor</h3></aside>`],
    ])('keeps it on %s', (_, html) => {
        const host = mount(html);

        expect(isBufferFocusDismissal(host.querySelector('#hit'))).toBe(false);
    });

    it('dismisses on a link without a target and on a node only focusable from code', () => {
        const host = mount('<a id="anchor">name</a><div tabindex="-1" id="region">pane</div>');

        expect(isBufferFocusDismissal(host.querySelector('#anchor'))).toBe(true);
        expect(isBufferFocusDismissal(host.querySelector('#region'))).toBe(true);
    });

    it('keeps it for a target that is not an element', () => {
        expect(isBufferFocusDismissal(null)).toBe(false);
        expect(isBufferFocusDismissal(document)).toBe(false);
    });
});

describe('isEndOfTextSelection', () => {
    it('sees a selection in the clicked node, not one left elsewhere', () => {
        const host = mount('<p id="selected">MemoryLayout BLOCK_SHARDED</p><h3 id="elsewhere">L1</h3>');
        const range = document.createRange();
        range.selectNodeContents(host.querySelector('#selected')!);
        select(range);

        expect(isEndOfTextSelection(host.querySelector('#selected')!)).toBe(true);
        expect(isEndOfTextSelection(host.querySelector('#elsewhere')!)).toBe(false);
    });

    it('does not count the caret an ordinary click on text leaves', () => {
        const host = mount('<p id="text">MemoryLayout BLOCK_SHARDED</p>');
        const caret = document.createRange();
        caret.setStart(host.querySelector('#text')!.firstChild!, 4);
        select(caret);

        expect(isEndOfTextSelection(host.querySelector('#text')!)).toBe(false);
    });
});
