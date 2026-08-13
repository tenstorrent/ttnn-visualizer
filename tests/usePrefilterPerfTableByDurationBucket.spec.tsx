// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@blueprintjs/core';
import { PerfTabIds } from '../src/definitions/Performance';
import { usePrefilterPerfTableByDurationBucket } from '../src/hooks/usePrefilterPerfTableByDurationBucket';
import { durationBucketFilterListAtom, isStackedViewAtom, perfSelectedTabAtom } from '../src/store/app';
import { setUpScrollResetMocks } from './helpers/mockScrollReset';
import { TestProviders } from './helpers/TestProviders';

function Probe() {
    const prefilter = usePrefilterPerfTableByDurationBucket();
    const durationFilter = useAtomValue(durationBucketFilterListAtom);
    const selectedTab = useAtomValue(perfSelectedTabAtom);
    const isStackedView = useAtomValue(isStackedViewAtom);

    return (
        <div>
            <span data-testid='duration-filter'>{durationFilter.join(',')}</span>
            <span data-testid='selected-tab'>{String(selectedTab)}</span>
            <span data-testid='stacked-view'>{String(isStackedView)}</span>
            <Button
                type='button'
                onClick={() => prefilter(10)}
            >
                filter-decade
            </Button>
            <Button
                type='button'
                onClick={() => prefilter(10, { amend: true })}
            >
                amend-decade
            </Button>
            <Button
                type='button'
                onClick={() => prefilter(100, { amend: true })}
            >
                amend-century
            </Button>
        </div>
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

beforeEach(() => {
    setUpScrollResetMocks();
});

describe('usePrefilterPerfTableByDurationBucket', () => {
    it('sets the duration filter and switches to the table tab', () => {
        render(
            <TestProviders initialAtomValues={[[perfSelectedTabAtom, PerfTabIds.CHARTS]]}>
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'filter-decade' }));

        expect(screen.getByTestId('duration-filter').textContent).toBe('10');
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.TABLE);
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
    });

    it('replaces an existing selection rather than unioning with it', () => {
        render(
            <TestProviders initialAtomValues={[[durationBucketFilterListAtom, [1, 100]]]}>
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'filter-decade' }));

        expect(screen.getByTestId('duration-filter').textContent).toBe('10');
    });

    it('leaves the stacked view, which the duration filter does not apply to', () => {
        render(
            <TestProviders initialAtomValues={[[isStackedViewAtom, true]]}>
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'filter-decade' }));

        expect(screen.getByTestId('stacked-view')).toHaveTextContent('false');
        expect(screen.getByTestId('duration-filter').textContent).toBe('10');
    });

    it('amends by adding a bucket without navigating away from the charts tab', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [durationBucketFilterListAtom, [1]],
                    [perfSelectedTabAtom, PerfTabIds.CHARTS],
                ]}
            >
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'amend-decade' }));

        expect(screen.getByTestId('duration-filter').textContent).toBe('1,10');
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
        expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it('amends by removing a selected bucket without navigating', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [durationBucketFilterListAtom, [1, 10]],
                    [perfSelectedTabAtom, PerfTabIds.CHARTS],
                ]}
            >
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'amend-decade' }));

        expect(screen.getByTestId('duration-filter').textContent).toBe('1');
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });

    it('amends the sole selected bucket to clear the filter', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [durationBucketFilterListAtom, [10]],
                    [perfSelectedTabAtom, PerfTabIds.CHARTS],
                ]}
            >
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'amend-decade' }));

        expect(screen.getByTestId('duration-filter').textContent).toBe('');
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });

    it('leaves the stacked view when amending', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [isStackedViewAtom, true],
                    [perfSelectedTabAtom, PerfTabIds.CHARTS],
                ]}
            >
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'amend-century' }));

        expect(screen.getByTestId('stacked-view')).toHaveTextContent('false');
        expect(screen.getByTestId('duration-filter').textContent).toBe('100');
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });
});
