// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PerfHeuristicFlags from '../src/components/performance/PerfHeuristicFlags';
import { TypedPerfTableRow } from '../src/definitions/PerfTable';
import { PERF_HEURISTIC_FLAG_DEFINITIONS, PerfHeuristicFlag } from '../src/definitions/PerfHeuristics';
import { OpType } from '../src/definitions/Performance';
import { TEST_IDS } from '../src/definitions/TestIds';

vi.mock('@blueprintjs/core', async () => {
    const original = await vi.importActual<typeof import('@blueprintjs/core')>('@blueprintjs/core');

    return {
        ...original,
        Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
            <div data-testid='tooltip-host'>
                <div data-testid='tooltip-content'>{content}</div>
                {children}
            </div>
        ),
    };
});

const makeRow = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        raw_op_code: 'Matmul',
        op_code: 'Matmul',
        ...overrides,
    }) as TypedPerfTableRow;

afterEach(cleanup);

describe('PerfHeuristicFlags', () => {
    it('renders nothing when heuristicFlags are empty', () => {
        const { container } = render(<PerfHeuristicFlags row={makeRow({ heuristicFlags: [] })} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders one chip per flag with data-flag attributes', () => {
        render(
            <PerfHeuristicFlags
                row={makeRow({
                    heuristicFlags: [PerfHeuristicFlag.DRAM_BOUND, PerfHeuristicFlag.RECOMPUTE_CANDIDATE],
                    heuristicFlagDetails: {
                        [PerfHeuristicFlag.DRAM_BOUND]: 'Bound: DRAM',
                        [PerfHeuristicFlag.RECOMPUTE_CANDIDATE]: 'Hash: abc123',
                    },
                })}
            />,
        );

        const chips = screen.getAllByTestId(TEST_IDS.PERF_HEURISTIC_FLAG);
        expect(chips).toHaveLength(2);
        expect(chips[0]).toHaveAttribute('data-flag', PerfHeuristicFlag.DRAM_BOUND);
        expect(chips[1]).toHaveAttribute('data-flag', PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
        expect(
            within(chips[0]).getByText(PERF_HEURISTIC_FLAG_DEFINITIONS[PerfHeuristicFlag.DRAM_BOUND].shortLabel),
        ).toBeInTheDocument();
        expect(
            within(chips[1]).getByText(
                PERF_HEURISTIC_FLAG_DEFINITIONS[PerfHeuristicFlag.RECOMPUTE_CANDIDATE].shortLabel,
            ),
        ).toBeInTheDocument();
    });

    it('renders description and metric detail inside the tooltip content', () => {
        render(
            <PerfHeuristicFlags
                row={makeRow({
                    heuristicFlags: [PerfHeuristicFlag.DRAM_BOUND],
                    heuristicFlagDetails: {
                        [PerfHeuristicFlag.DRAM_BOUND]: 'Bound: DRAM',
                    },
                })}
            />,
        );

        const tooltipContent = screen.getByTestId('tooltip-content');
        expect(
            within(tooltipContent).getByText(PERF_HEURISTIC_FLAG_DEFINITIONS[PerfHeuristicFlag.DRAM_BOUND].description),
        ).toBeInTheDocument();
        expect(within(tooltipContent).getByText('Bound: DRAM')).toBeInTheDocument();
    });
});
