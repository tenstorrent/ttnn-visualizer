// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it } from 'vitest';
import isClickAway from '../src/functions/isClickAway';

// The verdict for a real dispatched click, which is the only way `target` gets set.
const judge = (element: Element): boolean => {
    let verdict: boolean | undefined;
    const record = (event: MouseEvent) => {
        verdict = isClickAway(event);
    };
    document.addEventListener('click', record, true);
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.removeEventListener('click', record, true);
    if (verdict === undefined) {
        throw new Error('the click never reached the document');
    }
    return verdict;
};

const mount = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    return host;
};

afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
});

describe('isClickAway', () => {
    it('counts a click on plain content', () => {
        const host = mount('<table><tr><td id="cell">BLOCK_SHARDED</td></tr></table><h3 id="heading">L1</h3>');

        expect(judge(host.querySelector('#cell')!)).toBe(true);
        expect(judge(host.querySelector('#heading')!)).toBe(true);
        expect(judge(host)).toBe(true);
    });

    it.each([
        ['a button, through its icon', '<button><svg><path id="hit" /></svg></button>'],
        ['a link', '<a href="#x"><span id="hit">link</span></a>'],
        ['an input', '<input id="hit" />'],
        ['a select', '<select id="hit"></select>'],
        ['a label', '<label id="hit">Buffer zoom</label>'],
        ['a tab', '<div role="tab"><span id="hit">L1</span></div>'],
        ['a switch', '<div role="switch" id="hit"></div>'],
        ['anything tabbable', '<div tabindex="0"><span id="hit">cell</span></div>'],
        ['a canvas a click picks a buffer from', '<canvas id="hit"></canvas>'],
        ['a plot', '<div class="js-plotly-plot"><svg><rect id="hit" /></svg></div>'],
        ['the toast, which dismisses itself', '<div class="Toastify"><div id="hit">Tensor 3 selected</div></div>'],
        ['a portalled popup', '<div class="bp6-portal"><p id="hit">tooltip</p></div>'],
    ])('leaves a click on %s to that element', (_, html) => {
        const host = mount(html);

        expect(judge(host.querySelector('#hit')!)).toBe(false);
    });

    it('counts a link without a target and a node only focusable from code as content', () => {
        const host = mount('<a id="anchor">name</a><div tabindex="-1" id="region">pane</div>');

        expect(judge(host.querySelector('#anchor')!)).toBe(true);
        expect(judge(host.querySelector('#region')!)).toBe(true);
    });

    it('does not count the click that ends a text selection in what was clicked', () => {
        const host = mount('<p id="selected">MemoryLayout BLOCK_SHARDED</p><h3 id="elsewhere">L1</h3>');
        const range = document.createRange();
        range.selectNodeContents(host.querySelector('#selected')!);
        document.getSelection()?.addRange(range);

        expect(judge(host.querySelector('#selected')!)).toBe(false);
        // A selection left behind elsewhere does not stop a click away from counting.
        expect(judge(host.querySelector('#elsewhere')!)).toBe(true);
    });

    it('counts a click on text, which leaves a caret where it lands', () => {
        const host = mount('<p id="text">MemoryLayout BLOCK_SHARDED</p>');
        const caret = document.createRange();
        caret.setStart(host.querySelector('#text')!.firstChild!, 4);
        document.getSelection()?.addRange(caret);

        expect(judge(host.querySelector('#text')!)).toBe(true);
    });
});
