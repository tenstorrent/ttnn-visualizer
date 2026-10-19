// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BufferSummary from '../src/routes/BufferSummary';
import SideNavigation from '../src/components/SideNavigation';
import { activeToastAtom, selectedAddressAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import type { AtomProviderInitialValues } from './helpers/atomProvider';
import { BufferFocusProbe } from './helpers/BufferFocusProbe';
import { getBufferFocusProbe, pressAndRelease } from './helpers/bufferFocus';

vi.mock('../src/components/buffer-summary/BufferSummaryTab', () => ({ default: () => null }));
vi.mock('../src/components/buffer-summary/L1PeakComposition', () => ({ default: () => null }));
vi.mock('../src/hooks/useActiveSection', () => ({ useActiveSection: () => null }));
vi.mock('../src/hooks/useAPI', () => ({ useGetClusterDescription: () => ({ data: undefined }) }));

const ADDRESS = 0x4000;

// The rail sits beside the page, as in `Layout`, so a click on it is one the page has to judge.
const renderFocused = (
    focus: AtomProviderInitialValues = [
        [activeToastAtom, 'buffer-toast'],
        [selectedAddressAtom, ADDRESS],
    ],
) =>
    render(
        <TestProviders initialAtomValues={focus}>
            <SideNavigation />
            <BufferSummary />
            <BufferFocusProbe />
        </TestProviders>,
    );

afterEach(cleanup);

describe('BufferSummary dismissing a focused buffer (#2042)', () => {
    it('dismisses it on a click that lands on content', () => {
        renderFocused();
        expect(getBufferFocusProbe()).toHaveTextContent('focused');

        pressAndRelease(screen.getByRole('heading', { name: 'Buffers by operation' }));

        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
    });

    it('dismisses a toast with no buffer selection behind it, which the old overlay was gated on', () => {
        renderFocused([[activeToastAtom, 'buffer-toast']]);
        expect(getBufferFocusProbe()).toHaveTextContent('focused');

        pressAndRelease(screen.getByRole('heading', { name: 'Buffers by operation' }));

        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
    });

    it('keeps it through a tab switch', () => {
        renderFocused();

        pressAndRelease(screen.getByRole('tab', { name: /Peak composition/ }));

        expect(screen.getByRole('tab', { name: /Peak composition/ })).toHaveAttribute('aria-selected', 'true');
        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('dismisses it from blank space in the navigation rail', () => {
        // The overlay this replaces could not cover the rail without disabling its buttons.
        renderFocused();

        pressAndRelease(screen.getByRole('navigation', { name: 'Main navigation' }));

        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
    });

    it('keeps it through a rail button, which still works', () => {
        renderFocused();

        pressAndRelease(screen.getByRole('button', { name: 'Collapse navigation' }));

        expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false');
        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });
});
