// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@blueprintjs/core';
import { PerfTabIds } from '../src/definitions/Performance';
import { usePrefilterPerfTableByOpCode } from '../src/hooks/usePrefilterPerfTableByOpCode';
import { perfSelectedTabAtom, rawOpCodeFilterListAtom } from '../src/store/app';
import { setUpScrollResetMocks } from './helpers/mockScrollReset';
import { TestProviders } from './helpers/TestProviders';

function Probe() {
    const prefilter = usePrefilterPerfTableByOpCode();
    const rawOpCodeFilter = useAtomValue(rawOpCodeFilterListAtom);
    const selectedTab = useAtomValue(perfSelectedTabAtom);

    return (
        <div>
            <span data-testid='raw-op-filter'>{rawOpCodeFilter.join(',')}</span>
            <span data-testid='selected-tab'>{String(selectedTab)}</span>
            <Button
                type='button'
                onClick={() => prefilter('Matmul')}
            >
                filter-matmul
            </Button>
            <Button
                type='button'
                onClick={() => prefilter('')}
            >
                filter-empty
            </Button>
            <Button
                type='button'
                onClick={() => prefilter('Matmul', { additive: true })}
            >
                amend-matmul
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

describe('usePrefilterPerfTableByOpCode', () => {
    it('sets the raw op code filter and switches to the table tab', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [rawOpCodeFilterListAtom, ['Conv2d', 'Softmax']],
                    [perfSelectedTabAtom, PerfTabIds.CHARTS],
                ]}
            >
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'filter-matmul' }));

        expect(screen.getByTestId('raw-op-filter').textContent).toBe('Matmul');
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.TABLE);
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
    });

    it('ignores empty op codes', () => {
        render(
            <TestProviders initialAtomValues={[[rawOpCodeFilterListAtom, ['Conv2d']]]}>
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'filter-empty' }));

        expect(screen.getByTestId('raw-op-filter').textContent).toBe('Conv2d');
    });

    it('amends by adding an op code without navigating away from the charts tab', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [rawOpCodeFilterListAtom, ['Conv2d']],
                    [perfSelectedTabAtom, PerfTabIds.CHARTS],
                ]}
            >
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'amend-matmul' }));

        expect(screen.getByTestId('raw-op-filter').textContent).toBe('Conv2d,Matmul');
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
        expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it('amends by removing a selected op code without navigating', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [rawOpCodeFilterListAtom, ['Conv2d', 'Matmul']],
                    [perfSelectedTabAtom, PerfTabIds.CHARTS],
                ]}
            >
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'amend-matmul' }));

        expect(screen.getByTestId('raw-op-filter').textContent).toBe('Conv2d');
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });

    it('amends the sole selected op code to clear the filter', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [rawOpCodeFilterListAtom, ['Matmul']],
                    [perfSelectedTabAtom, PerfTabIds.CHARTS],
                ]}
            >
                <Probe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'amend-matmul' }));

        expect(screen.getByTestId('raw-op-filter').textContent).toBe('');
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });
});
