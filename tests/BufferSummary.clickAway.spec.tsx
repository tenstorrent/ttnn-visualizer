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
import { BufferFocusProbe } from './helpers/BufferFocusProbe';
import { bufferFocus, pressAndRelease } from './helpers/bufferFocus';

vi.mock('../src/components/buffer-summary/BufferSummaryTab', () => ({ default: () => null }));
vi.mock('../src/components/buffer-summary/L1PeakComposition', () => ({ default: () => null }));
vi.mock('../src/hooks/useActiveSection', () => ({ useActiveSection: () => null }));
vi.mock('../src/hooks/useAPI', () => ({ useGetClusterDescription: () => ({ data: undefined }) }));

const ADDRESS = 0x4000;

// The rail sits beside the page, as in `Layout`, so a click on it is one the page has to judge.
const renderFocused = () =>
    render(
        <TestProviders
            initialAtomValues={[
                [activeToastAtom, 'buffer-toast'],
                [selectedAddressAtom, ADDRESS],
            ]}
        >
            <SideNavigation />
            <BufferSummary />
            <BufferFocusProbe />
        </TestProviders>,
    );

afterEach(cleanup);

describe('BufferSummary dismissing a focused buffer (#2042)', () => {
    it('dismisses it on a click that lands on content', () => {
        renderFocused();
        expect(bufferFocus()).toHaveTextContent('focused');

        pressAndRelease(screen.getByRole('heading', { name: 'Buffers by operation' }));

        expect(bufferFocus()).toHaveTextContent('dismissed');
    });

    it('keeps it through a tab switch', () => {
        renderFocused();

        pressAndRelease(screen.getByRole('tab', { name: /Peak composition/ }));

        expect(screen.getByRole('tab', { name: /Peak composition/ })).toHaveAttribute('aria-selected', 'true');
        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('dismisses it from blank space in the navigation rail', () => {
        // The overlay this replaces could not cover the rail without disabling its buttons.
        renderFocused();

        pressAndRelease(screen.getByRole('navigation', { name: 'Main navigation' }));

        expect(bufferFocus()).toHaveTextContent('dismissed');
    });

    it('keeps it through a rail button, which still works', () => {
        renderFocused();

        pressAndRelease(screen.getByRole('button', { name: 'Collapse navigation' }));

        expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false');
        expect(bufferFocus()).toHaveTextContent('focused');
    });
});
