// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '@blueprintjs/core';
import { BufferType } from '../src/model/BufferType';
import { DeviceOperationLayoutTypes } from '../src/model/APIData';
import { useResetPerfTableSessionState } from '../src/hooks/useResetPerfTableSessionState';
import {
    bufferTypeFilterListAtom,
    durationBucketFilterListAtom,
    layoutFilterListAtom,
    mathFilterListAtom,
    rawOpCodeFilterListAtom,
    selectedPerfRowIdAtom,
} from '../src/store/app';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { TestProviders } from './helpers/TestProviders';

const SEEDED_STATE: AtomProviderInitialValues = [
    [selectedPerfRowIdAtom, 42],
    [mathFilterListAtom, ['HiFi4']],
    [rawOpCodeFilterListAtom, ['Matmul']],
    [bufferTypeFilterListAtom, [BufferType.L1]],
    [layoutFilterListAtom, [DeviceOperationLayoutTypes.TILE]],
    [durationBucketFilterListAtom, [10]],
];

function Probe() {
    const resetPerfTableSessionState = useResetPerfTableSessionState();

    return (
        <div>
            <span data-testid='selected-row'>{String(useAtomValue(selectedPerfRowIdAtom))}</span>
            <span data-testid='math-filter'>{useAtomValue(mathFilterListAtom).join(',')}</span>
            <span data-testid='raw-op-filter'>{useAtomValue(rawOpCodeFilterListAtom).join(',')}</span>
            <span data-testid='buffer-filter'>{useAtomValue(bufferTypeFilterListAtom).join(',')}</span>
            <span data-testid='layout-filter'>{useAtomValue(layoutFilterListAtom).join(',')}</span>
            <span data-testid='duration-filter'>{useAtomValue(durationBucketFilterListAtom).join(',')}</span>
            <Button
                type='button'
                onClick={resetPerfTableSessionState}
            >
                reset
            </Button>
        </div>
    );
}

afterEach(() => {
    cleanup();
});

describe('useResetPerfTableSessionState', () => {
    it('clears the row selection and every chip filter', () => {
        render(
            <TestProviders initialAtomValues={SEEDED_STATE}>
                <Probe />
            </TestProviders>,
        );

        // Guards against the reset passing vacuously because the atoms were never seeded
        expect(screen.getByTestId('duration-filter')).toHaveTextContent('10');

        fireEvent.click(screen.getByRole('button', { name: 'reset' }));

        expect(screen.getByTestId('selected-row')).toHaveTextContent('null');
        expect(screen.getByTestId('math-filter').textContent).toBe('');
        expect(screen.getByTestId('raw-op-filter').textContent).toBe('');
        expect(screen.getByTestId('buffer-filter').textContent).toBe('');
        expect(screen.getByTestId('layout-filter').textContent).toBe('');
        expect(screen.getByTestId('duration-filter').textContent).toBe('');
    });
});
