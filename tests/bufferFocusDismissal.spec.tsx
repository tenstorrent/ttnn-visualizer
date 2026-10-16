// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type ReactElement } from 'react';
import { Classes } from '@blueprintjs/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { isBufferFocusDismissal, isEndOfTextSelection } from '../src/functions/bufferFocusDismissal';
import { KEEPS_BUFFER_FOCUS_CLASS } from '../src/definitions/BufferFocus';

const select = (range: Range) => {
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
};

afterEach(() => {
    cleanup();
    document.getSelection()?.removeAllRanges();
});

describe('isBufferFocusDismissal', () => {
    it('dismisses on plain content', () => {
        const { container } = render(
            <>
                <table>
                    <tbody>
                        <tr>
                            <td>BLOCK_SHARDED</td>
                        </tr>
                    </tbody>
                </table>
                <h3>L1</h3>
            </>,
        );

        expect(isBufferFocusDismissal(screen.getByRole('cell'))).toBe(true);
        expect(isBufferFocusDismissal(screen.getByRole('heading'))).toBe(true);
        expect(isBufferFocusDismissal(container)).toBe(true);
    });

    it.each<[string, () => ReactElement]>([
        [
            'a button, through its icon',
            () => (
                <button type='button'>
                    <svg>
                        <path data-testid='hit' />
                    </svg>
                </button>
            ),
        ],
        [
            'a link',
            () => (
                <a href='#x'>
                    <span data-testid='hit'>link</span>
                </a>
            ),
        ],
        ['an input', () => <input data-testid='hit' />],
        ['a select', () => <select data-testid='hit' />],
        ['a text area', () => <textarea data-testid='hit' />],
        // eslint-disable-next-line jsx-a11y/label-has-associated-control -- the bare label is the case under test
        ['a label', () => <label data-testid='hit'>Buffer zoom</label>],
        [
            'a disclosure summary',
            () => (
                <details>
                    <summary data-testid='hit'>More</summary>
                </details>
            ),
        ],
        [
            'editable text',
            () => (
                <div
                    contentEditable
                    suppressContentEditableWarning
                >
                    <span data-testid='hit'>note</span>
                </div>
            ),
        ],
        [
            'a role button',
            () => (
                <div role='button'>
                    <span data-testid='hit'>Deselect</span>
                </div>
            ),
        ],
        [
            'a role link',
            () => (
                <span
                    role='link'
                    data-testid='hit'
                >
                    source
                </span>
            ),
        ],
        [
            'a checkbox',
            () => (
                <div
                    role='checkbox'
                    aria-checked='false'
                    data-testid='hit'
                />
            ),
        ],
        [
            'a radio',
            () => (
                <div
                    role='radio'
                    aria-checked='false'
                    data-testid='hit'
                />
            ),
        ],
        [
            'a tab',
            () => (
                <div role='tab'>
                    <span data-testid='hit'>L1</span>
                </div>
            ),
        ],
        [
            'a switch',
            () => (
                <div
                    role='switch'
                    aria-checked='false'
                    data-testid='hit'
                />
            ),
        ],
        [
            'a menu item',
            () => (
                <ul role='menu'>
                    <li role='menuitem'>
                        <span data-testid='hit'>Copy</span>
                    </li>
                </ul>
            ),
        ],
        [
            'an option',
            () => (
                <ul role='listbox'>
                    <li
                        role='option'
                        aria-selected='false'
                        data-testid='hit'
                    >
                        Top 10
                    </li>
                </ul>
            ),
        ],
        [
            'a slider handle',
            () => (
                <span
                    role='slider'
                    aria-valuenow={0}
                    data-testid='hit'
                />
            ),
        ],
        [
            'anything tabbable',
            () => (
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a tab stop on a non-control is the case under test
                <div tabIndex={0}>
                    <span data-testid='hit'>cell</span>
                </div>
            ),
        ],
        [
            'a slider track, which moves a handle',
            () => (
                <div className={Classes.SLIDER}>
                    <div data-testid='hit' />
                </div>
            ),
        ],
        ['a canvas a click picks a buffer from', () => <canvas data-testid='hit' />],
        [
            'a plot',
            () => (
                <div className='js-plotly-plot'>
                    <svg>
                        <rect data-testid='hit' />
                    </svg>
                </div>
            ),
        ],
        [
            'the toast, which dismisses itself',
            () => (
                <section className='Toastify'>
                    <div data-testid='hit'>Tensor 3</div>
                </section>
            ),
        ],
        [
            'a portalled popup',
            () => (
                <div className={Classes.PORTAL}>
                    <p data-testid='hit'>tooltip</p>
                </div>
            ),
        ],
        [
            'a surface marked to keep it',
            () => (
                <aside className={KEEPS_BUFFER_FOCUS_CLASS}>
                    <h3 data-testid='hit'>Tensor</h3>
                </aside>
            ),
        ],
    ])('keeps it on %s', (_, renderFixture) => {
        render(renderFixture());

        expect(isBufferFocusDismissal(screen.getByTestId('hit'))).toBe(false);
    });

    it('dismisses on a link without a target and on a node only focusable from code', () => {
        render(
            <>
                {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- a link with no target is the case under test */}
                <a>name</a>
                <div
                    tabIndex={-1}
                    data-testid='region'
                >
                    pane
                </div>
            </>,
        );

        expect(isBufferFocusDismissal(screen.getByText('name'))).toBe(true);
        expect(isBufferFocusDismissal(screen.getByTestId('region'))).toBe(true);
    });

    it('keeps it for a target that is not an element', () => {
        expect(isBufferFocusDismissal(null)).toBe(false);
        expect(isBufferFocusDismissal(document)).toBe(false);
    });
});

describe('isEndOfTextSelection', () => {
    it('sees a selection in the clicked node, not one left elsewhere', () => {
        render(
            <>
                <p>MemoryLayout BLOCK_SHARDED</p>
                <h3>L1</h3>
            </>,
        );
        const selected = screen.getByText('MemoryLayout BLOCK_SHARDED');
        const range = document.createRange();
        range.selectNodeContents(selected);
        select(range);

        expect(isEndOfTextSelection(selected)).toBe(true);
        expect(isEndOfTextSelection(screen.getByRole('heading'))).toBe(false);
    });

    it('is false with nothing selected at all', () => {
        render(<p>MemoryLayout BLOCK_SHARDED</p>);
        document.getSelection()?.removeAllRanges();

        expect(isEndOfTextSelection(screen.getByText('MemoryLayout BLOCK_SHARDED'))).toBe(false);
    });

    it('does not count the caret an ordinary click on text leaves', () => {
        render(<p>MemoryLayout BLOCK_SHARDED</p>);
        const text = screen.getByText('MemoryLayout BLOCK_SHARDED');
        const caret = document.createRange();
        caret.setStart(text.firstChild!, 4);
        select(caret);

        expect(isEndOfTextSelection(text)).toBe(false);
    });
});
