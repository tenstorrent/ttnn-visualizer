// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import OperationPerfRowBar from '../src/components/OperationPerfRowBar';
import { TestProviders } from './helpers/TestProviders';

afterEach(cleanup);

describe('OperationPerfRowBar', () => {
    it('renders nothing when no score is provided', () => {
        const { container } = render(
            <TestProviders>
                <OperationPerfRowBar score={undefined} />
            </TestProviders>,
        );

        expect(container.querySelector('.operation-perf-row-bar')).toBeNull();
    });

    it('floors the fill at MIN_BAR_PERCENT (2%) for a near-zero score so it stays visible', () => {
        const { container } = render(
            <TestProviders>
                <OperationPerfRowBar score={{ deviceTimeNs: 10_000, t: 0 }} />
            </TestProviders>,
        );

        const fill = container.querySelector('.operation-perf-row-bar-fill') as HTMLElement | null;
        expect(fill).not.toBeNull();
        expect(fill?.style.width).toBe('2%');
    });

    it('paints the fill to 100% at t=1 and surfaces the formatted duration in the aria-label', () => {
        const { container } = render(
            <TestProviders>
                <OperationPerfRowBar score={{ deviceTimeNs: 5_000_000, t: 1 }} />
            </TestProviders>,
        );

        const fill = container.querySelector('.operation-perf-row-bar-fill') as HTMLElement | null;
        expect(fill).not.toBeNull();
        expect(fill?.style.width).toBe('100%');

        const bar = screen.getByRole('img');
        expect(bar.getAttribute('aria-label')).toMatch(/Device kernel duration:\s+5(?:\.\d+)?\s*ms/);
    });
});
