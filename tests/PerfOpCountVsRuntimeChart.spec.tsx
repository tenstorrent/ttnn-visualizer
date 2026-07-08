// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PerfOpCountVsRuntimeChart from '../src/components/performance/PerfOpCountVsRuntimeChart';
import { MarkerColours, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { TestProviders } from './helpers/TestProviders';
import { firePlotClick, resetPlotPropsCapture } from './mocks/plotComponent';

const matmulMarker = { opCode: 'Matmul', colour: MarkerColours[0] };
const convMarker = { opCode: 'Conv2d', colour: MarkerColours[1] };

const row = (rawOpCode: string): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: rawOpCode,
        raw_op_code: rawOpCode,
        device_time: 10,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        id: 1,
    }) as unknown as TypedPerfTableRow;

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('PerfOpCountVsRuntimeChart', () => {
    it('calls onOpCodeClick with customdata from a bar segment click', () => {
        const onOpCodeClick = vi.fn();

        render(
            <TestProviders>
                <PerfOpCountVsRuntimeChart
                    datasets={[[row('Matmul'), row('Conv2d')]]}
                    selectedOpCodes={[matmulMarker, convMarker]}
                    onOpCodeClick={onOpCodeClick}
                />
            </TestProviders>,
        );

        firePlotClick({ points: [{ customdata: ['Matmul'] }] } as never);

        expect(onOpCodeClick).toHaveBeenCalledWith('Matmul');
    });

    it('does not call onOpCodeClick when customdata is missing', () => {
        const onOpCodeClick = vi.fn();

        render(
            <TestProviders>
                <PerfOpCountVsRuntimeChart
                    datasets={[[row('Matmul')]]}
                    selectedOpCodes={[matmulMarker]}
                    onOpCodeClick={onOpCodeClick}
                />
            </TestProviders>,
        );

        firePlotClick({ points: [{}] } as never);

        expect(onOpCodeClick).not.toHaveBeenCalled();
    });
});
