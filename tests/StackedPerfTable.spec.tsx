// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StackedPerformanceTable from '../src/components/performance/StackedPerfTable';
import { StackedColumnKeys, TypedStackedPerfRow } from '../src/definitions/StackedPerfTable';
import { OpType } from '../src/definitions/Performance';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useGetNPEManifest, usePerfMeta } from '../src/hooks/useAPI';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetNPEManifest: vi.fn(),
    usePerfMeta: vi.fn(),
}));

const stackedRow = (opCode: string): TypedStackedPerfRow =>
    ({
        [StackedColumnKeys.Percent]: 100,
        [StackedColumnKeys.OpCode]: opCode,
        [StackedColumnKeys.Device]: 0,
        [StackedColumnKeys.DeviceTimeSumUs]: 1,
        [StackedColumnKeys.OpsCount]: 1,
        op_type: OpType.DEVICE_OP,
    }) as unknown as TypedStackedPerfRow;

interface RenderOptions {
    stackedData?: TypedStackedPerfRow[];
    isLoading?: boolean;
}

function renderStacked({ stackedData = [], isLoading = false }: RenderOptions = {}) {
    return render(
        <TestProviders>
            <StackedPerformanceTable
                data={[]}
                stackedData={stackedData}
                stackedComparisonData={[]}
                filters={null}
                reportName='unit-test'
                isLoading={isLoading}
            />
        </TestProviders>,
    );
}

afterEach(cleanup);

beforeEach(() => {
    (useGetNPEManifest as Mock).mockReturnValue({ data: [], error: null });
    (usePerfMeta as Mock).mockReturnValue({ data: null, isLoading: false });
});

describe('StackedPerformanceTable loading state', () => {
    it('renders the skeleton instead of data rows while loading', () => {
        renderStacked({ stackedData: [stackedRow('Matmul')], isLoading: true });

        const skeleton = screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON);
        expect(skeleton).toBeInTheDocument();
        expect(skeleton).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
    });

    it('keeps the device-architecture strip mounted while loading (scoped skeleton)', () => {
        renderStacked({ isLoading: true });

        expect(screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeInTheDocument();
        expect(screen.getByText('Arch:')).toBeInTheDocument();
    });

    it('shows the empty state rather than the skeleton when not loading and there are no rows', () => {
        renderStacked();

        expect(screen.queryByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeNull();
        expect(screen.getByText('No data to display')).toBeInTheDocument();
    });
});
