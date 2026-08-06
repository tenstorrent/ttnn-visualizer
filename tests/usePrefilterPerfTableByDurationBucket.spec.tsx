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
import { durationBucketFilterListAtom, perfSelectedTabAtom } from '../src/store/app';
import { setUpScrollResetMocks } from './helpers/mockScrollReset';
import { TestProviders } from './helpers/TestProviders';

function Probe() {
    const prefilter = usePrefilterPerfTableByDurationBucket();
    const durationFilter = useAtomValue(durationBucketFilterListAtom);
    const selectedTab = useAtomValue(perfSelectedTabAtom);

    return (
        <div>
            <span data-testid='duration-filter'>{durationFilter.join(',')}</span>
            <span data-testid='selected-tab'>{String(selectedTab)}</span>
            <Button
                type='button'
                onClick={() => prefilter(10)}
            >
                filter-decade
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
});
