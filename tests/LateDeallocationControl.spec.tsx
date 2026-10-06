// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LateDeallocationControl from '../src/components/LateDeallocationControl';
import { TEST_IDS } from '../src/definitions/TestIds';

// Render Blueprint Tooltip transparently so the content can be asserted on
// without portal mounts in jsdom.
vi.mock('@blueprintjs/core', async () => {
    const original = await vi.importActual<typeof import('@blueprintjs/core')>('@blueprintjs/core');
    return {
        ...original,
        Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
            <div
                data-testid='tooltip-host'
                data-content={typeof content === 'string' ? content : ''}
            >
                {children}
            </div>
        ),
    };
});

type ControlProps = Parameters<typeof LateDeallocationControl>[0];

const renderControl = (props: Partial<ControlProps> = {}) =>
    render(
        <LateDeallocationControl
            count={2}
            countSummary='2 tensors held past their last use at this operation'
            checked={false}
            onChange={vi.fn()}
            {...props}
        />,
    );

const getSwitch = (): HTMLInputElement =>
    screen.getByLabelText(/mark late tensor deallocations/i, {
        selector: 'input[type="checkbox"]',
    }) as HTMLInputElement;

afterEach(cleanup);

describe('LateDeallocationControl', () => {
    it('shows the count as a warning, named and explained by the summary', () => {
        renderControl();

        const count = screen.getByTestId(TEST_IDS.LATE_DEALLOC_COUNT);
        expect(count).toHaveTextContent('2');
        expect(count).toHaveClass(Classes.INTENT_WARNING);
        expect(count).toHaveAttribute('aria-label', '2 tensors held past their last use at this operation');
        expect(count.closest('[data-testid="tooltip-host"]')?.getAttribute('data-content')).toBe(
            '2 tensors held past their last use at this operation',
        );
    });

    // Operation Details leaves `disabled` unset: the switch is global, so a
    // clean operation must not leave it reading "off" or untoggleable. #1862
    it('stays enabled and follows `checked` at a zero count unless told otherwise', () => {
        renderControl({ count: 0, checked: true });

        const count = screen.getByTestId(TEST_IDS.LATE_DEALLOC_COUNT);
        expect(count).toHaveTextContent('0');
        expect(count).not.toHaveClass(Classes.INTENT_WARNING);
        expect(getSwitch()).not.toBeDisabled();
        expect(getSwitch()).toBeChecked();
    });

    it('shows an unknown count as a neutral dash, still named by the summary', () => {
        renderControl({ count: null, countSummary: 'Late deallocations are still loading' });

        const count = screen.getByTestId(TEST_IDS.LATE_DEALLOC_COUNT);
        expect(count).toHaveTextContent('–');
        expect(count).not.toHaveClass(Classes.INTENT_WARNING);
        expect(count).toHaveAttribute('aria-label', 'Late deallocations are still loading');
    });

    it('disables the switch when asked to', () => {
        renderControl({ disabled: true });

        expect(getSwitch()).toBeDisabled();
    });

    it('calls onChange when the switch is flipped', () => {
        const onChange = vi.fn();
        renderControl({ onChange });

        fireEvent.click(getSwitch());

        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
