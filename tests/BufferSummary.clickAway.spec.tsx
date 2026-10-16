// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BufferSummary from '../src/routes/BufferSummary';
import { activeToastAtom, selectedAddressAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/components/buffer-summary/BufferSummaryTab', () => ({ default: () => null }));
vi.mock('../src/components/buffer-summary/L1PeakComposition', () => ({ default: () => null }));
vi.mock('../src/hooks/useActiveSection', () => ({ useActiveSection: () => null }));

const ADDRESS = 0x4000;

const FocusProbe = () => {
    const toast = useAtomValue(activeToastAtom);
    const address = useAtomValue(selectedAddressAtom);
    return <output aria-label='Focused buffer'>{`${toast ?? 'none'}:${address ?? 'none'}`}</output>;
};

const renderFocused = () =>
    render(
        <TestProviders
            initialAtomValues={[
                [activeToastAtom, 'buffer-toast'],
                [selectedAddressAtom, ADDRESS],
            ]}
        >
            <BufferSummary />
            <FocusProbe />
        </TestProviders>,
    );

const focus = () => screen.getByRole('status', { name: 'Focused buffer' });

afterEach(cleanup);

describe('BufferSummary dismissing a focused buffer (#2042)', () => {
    it('dismisses it on a click that lands on content', () => {
        renderFocused();
        expect(focus()).toHaveTextContent(`buffer-toast:${ADDRESS}`);

        fireEvent.click(screen.getByRole('heading', { name: 'Buffers by operation' }));

        expect(focus()).toHaveTextContent('none:none');
    });

    it('keeps it through a tab switch', () => {
        renderFocused();

        fireEvent.click(screen.getByRole('tab', { name: /Peak composition/ }));

        expect(screen.getByRole('tab', { name: /Peak composition/ })).toHaveAttribute('aria-selected', 'true');
        expect(focus()).toHaveTextContent(`buffer-toast:${ADDRESS}`);
    });
});
