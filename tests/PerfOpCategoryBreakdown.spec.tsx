// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OpType } from '../src/definitions/Performance';
import { OperationCategories } from '../src/definitions/StackedPerfTable';
import { TEST_IDS } from '../src/definitions/TestIds';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import PerfOpCategoryBreakdown, {
    HOST_CATEGORY_EXPLANATION,
    OTHER_CATEGORY_EXPLANATION,
} from '../src/components/performance/PerfOpCategoryBreakdown';

const makeRow = (id: string, opCategory: OperationCategories | null, deviceTime: number | null) =>
    ({
        id,
        op_type: OpType.DEVICE_OP,
        op_code: `Op${id}`,
        raw_op_code: `Op${id}`,
        op_category: opCategory,
        device_time: deviceTime,
    }) as unknown as TypedPerfTableRow;

afterEach(cleanup);

describe('PerfOpCategoryBreakdown', () => {
    it('states each category share of device time and what Other means', () => {
        render(
            <PerfOpCategoryBreakdown
                rows={[makeRow('1', OperationCategories.COMPUTE, 75), makeRow('2', OperationCategories.OTHER, 25)]}
            />,
        );

        const breakdown = screen.getByTestId(TEST_IDS.PERF_OP_CATEGORY_BREAKDOWN);

        expect(breakdown).toHaveTextContent('Device time by op category');
        expect(breakdown).toHaveTextContent('Compute 75%');
        expect(breakdown).toHaveTextContent('Other 25%');
        expect(breakdown).toHaveTextContent(OTHER_CATEGORY_EXPLANATION);
        expect(breakdown).not.toHaveTextContent('Unclassified');
        expect(breakdown).not.toHaveTextContent(HOST_CATEGORY_EXPLANATION);
    });

    it('shows unclassified time and explains the missing Host share when they apply', () => {
        render(
            <PerfOpCategoryBreakdown
                rows={[
                    makeRow('1', OperationCategories.COMPUTE, 90),
                    makeRow('2', null, 10),
                    makeRow('3', OperationCategories.HOST, null),
                ]}
            />,
        );

        const breakdown = screen.getByTestId(TEST_IDS.PERF_OP_CATEGORY_BREAKDOWN);

        expect(breakdown).toHaveTextContent('Unclassified 10%');
        expect(breakdown).toHaveTextContent(HOST_CATEGORY_EXPLANATION);
    });

    it('lists the largest Other ops first when expanded', () => {
        render(
            <PerfOpCategoryBreakdown
                rows={[
                    makeRow('1', OperationCategories.OTHER, 5),
                    makeRow('2', OperationCategories.OTHER, 50),
                    makeRow('3', OperationCategories.COMPUTE, 45),
                ]}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Largest Other ops \(2 of 2\)/ }));

        const items = within(screen.getByRole('list')).getAllByRole('listitem');

        expect(items.map((item) => item.textContent)).toEqual(['Op2 50 µs', 'Op1 5 µs']);
    });

    it('renders nothing without device time', () => {
        render(<PerfOpCategoryBreakdown rows={[makeRow('1', OperationCategories.HOST, null)]} />);

        expect(screen.queryByTestId(TEST_IDS.PERF_OP_CATEGORY_BREAKDOWN)).toBeNull();
    });
});
