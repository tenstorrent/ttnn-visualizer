// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Classes } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import OpGraphBlockExpander from '../src/components/operation-graph/OpGraphBlockExpander';
import OpGraphDeviceOpExpander from '../src/components/operation-graph/OpGraphDeviceOpExpander';
import {
    OpGraphBlockExpansionContext,
    OpGraphExpansionContext,
} from '../src/components/operation-graph/opGraphExpansionContext';

const FOLD_CHEVRON = '▾';

const glyphOf = (chip: HTMLElement) => chip.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null;

const renderDeviceOpChip = (isExpanded: boolean, toggle = vi.fn()) => {
    render(
        <OpGraphExpansionContext.Provider value={toggle}>
            <OpGraphDeviceOpExpander
                operationId={14}
                count={7}
                isExpanded={isExpanded}
            />
        </OpGraphExpansionContext.Provider>,
    );
    return toggle;
};

const renderBlockChip = (isExpanded: boolean, toggle = vi.fn()) => {
    render(
        <OpGraphBlockExpansionContext.Provider value={toggle}>
            <OpGraphBlockExpander
                instanceId='block:12'
                opCount={4}
                isExpanded={isExpanded}
            />
        </OpGraphBlockExpansionContext.Provider>,
    );
    return toggle;
};

afterEach(cleanup);

// With every repeat unrolled, a chip carrying the fold chevron still read as a
// folded block, so the two chips must differ by glyph and not only by colour. #2210
describe('device-operation chip', () => {
    it('marks the operation with the device-operation icon instead of the fold chevron', () => {
        renderDeviceOpChip(false);
        const chip = screen.getByRole('button', { name: 'Show 7 device operations' });

        expect(glyphOf(chip)).toBe(IconNames.CUBE_ADD);
        expect(chip).not.toHaveTextContent(FOLD_CHEVRON);
        expect(chip).toHaveTextContent('7');
        expect(chip).toHaveAttribute('aria-expanded', 'false');
        expect(chip).toHaveAttribute('title', 'Show 7 device operations');
    });

    it('switches to the remove icon once the device operations are showing', () => {
        renderDeviceOpChip(true);
        const chip = screen.getByRole('button', { name: 'Hide device operations' });

        expect(glyphOf(chip)).toBe(IconNames.CUBE_REMOVE);
        expect(chip).not.toHaveTextContent(FOLD_CHEVRON);
        expect(chip).toHaveAttribute('aria-expanded', 'true');
        expect(chip).toHaveAttribute('title', 'Hide device operations');
    });

    it('hides the icon from assistive technology, leaving the label to name the chip', () => {
        renderDeviceOpChip(false);
        const chip = screen.getByRole('button', { name: 'Show 7 device operations' });

        expect(chip.querySelector(`.${Classes.ICON}`)).toHaveAttribute('aria-hidden', 'true');
    });

    it('stays a native button that toggles its operation without selecting it', () => {
        const toggle = renderDeviceOpChip(false);
        // React Flow selects the node on mousedown. React stops the native event at
        // its root as well, so a listener above the tree hears it only if it leaked.
        const onMouseDownAbove = vi.fn();
        document.addEventListener('mousedown', onMouseDownAbove);
        const chip = screen.getByRole('button', { name: 'Show 7 device operations' });

        fireEvent.mouseDown(chip);
        fireEvent.click(chip);
        document.removeEventListener('mousedown', onMouseDownAbove);

        expect(chip).toHaveAttribute('type', 'button');
        expect(toggle).toHaveBeenCalledExactlyOnceWith(14);
        expect(onMouseDownAbove).not.toHaveBeenCalled();
    });
});

describe('folded block chip', () => {
    it.each([
        [false, 'Unroll 4 operations'],
        [true, 'Fold 4 operations'],
    ])('keeps the fold chevron and no icon (expanded: %s)', (isExpanded, name) => {
        renderBlockChip(isExpanded);
        const chip = screen.getByRole('button', { name });

        expect(chip).toHaveTextContent(`${FOLD_CHEVRON}4`);
        expect(glyphOf(chip)).toBeNull();
        expect(chip).toHaveAttribute('aria-expanded', String(isExpanded));
    });

    it('toggles its own block', () => {
        const toggle = renderBlockChip(false);

        fireEvent.click(screen.getByRole('button', { name: 'Unroll 4 operations' }));

        expect(toggle).toHaveBeenCalledExactlyOnceWith('block:12');
    });
});
