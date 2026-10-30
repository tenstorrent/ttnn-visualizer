// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The footer's range panel mounts collapsed, so its sliders first measure a zero-width track. Each slider has to
 * remount once its container has a width, or it converts every drag with that zero width and snaps to an end.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Range from '../src/components/RangeSlider';
import { TestProviders } from './helpers/TestProviders';
import { getObserverFor, installCapturingResizeObserver } from './helpers/capturingResizeObserver';

// Range copies this into state from an effect, so it has to be the same array on every render
const { OPERATION_RANGE } = vi.hoisted(() => ({ OPERATION_RANGE: [1, 51] }));

vi.mock('../src/hooks/useAPI', () => ({
    useGetClusterDescription: () => ({ error: null }),
    useGetDeviceOperationListPerf: () => [],
    useOpToPerfIdFiltered: () => [],
    useOperationListRange: () => OPERATION_RANGE,
    useOperationsList: () => ({ data: undefined }),
    usePerformanceRange: () => null,
    usePerformanceReport: () => ({ data: undefined, error: null }),
}));

beforeEach(installCapturingResizeObserver);

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

it('remounts the operation range slider once its container reports a width', async () => {
    render(
        <TestProviders>
            <Range />
        </TestProviders>,
    );

    const handle = await screen.findByRole('slider', { name: 'Operation min range handle' });
    const container = handle.closest('.slider-container');

    expect(container).not.toBeNull();
    getObserverFor(container!).report(600);

    expect(screen.getByRole('slider', { name: 'Operation min range handle' })).not.toBe(handle);
});
