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
        </div>
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        callback(0);
        return 0;
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
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

        expect(screen.getByTestId('raw-op-filter')).toHaveTextContent('Matmul');
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

        expect(screen.getByTestId('raw-op-filter')).toHaveTextContent('Conv2d');
    });
});
