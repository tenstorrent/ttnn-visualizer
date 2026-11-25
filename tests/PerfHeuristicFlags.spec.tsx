// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PerfHeuristicFlags from '../src/components/performance/PerfHeuristicFlags';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import {
    PERF_HEURISTIC_FLAG_DEFINITIONS,
    PERF_HEURISTIC_FLAG_SOURCE_LABELS,
    PerfHeuristicFlag,
    PerfHeuristicFlagSource,
    UTILISATION_UNKNOWN_NOTE,
} from '../src/definitions/PerfHeuristics';
import { OpType } from '../src/definitions/Performance';
import { ColumnKeys, Columns } from '../src/definitions/PerfTable';
import { TEST_IDS } from '../src/definitions/TestIds';
import { annotatePerfHeuristicFlags } from '../src/functions/computePerfHeuristicFlags';
import { formatCell } from '../src/functions/perfFunctions';

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

    it('renders nothing when the note is off as well', () => {
        const { container } = render(
            <PerfHeuristicFlags row={makeRow({ heuristicFlags: [], hasUtilisationUnknownNote: false })} />,
        );

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

    it('shows the utilisation-unknown note in a tag with no intent, not as a flag', () => {
        render(<PerfHeuristicFlags row={makeRow({ heuristicFlags: [], hasUtilisationUnknownNote: true })} />);

        const note = screen.getByTestId(TEST_IDS.PERF_UTILISATION_UNKNOWN);
        expect(note).toHaveTextContent(UTILISATION_UNKNOWN_NOTE.shortLabel);
        expect(note.className).not.toMatch(/intent/);
        expect(screen.queryByTestId(TEST_IDS.PERF_HEURISTIC_FLAG)).not.toBeInTheDocument();

        const tooltipContent = screen.getByTestId('tooltip-content');
        expect(within(tooltipContent).getByText(UTILISATION_UNKNOWN_NOTE.label)).toBeInTheDocument();
        expect(within(tooltipContent).getByText(UTILISATION_UNKNOWN_NOTE.detail)).toBeInTheDocument();
        expect(UTILISATION_UNKNOWN_NOTE.detail).toMatch(/^Not modelled/);
    });

    it('places the note after the flags', () => {
        render(
            <PerfHeuristicFlags
                row={makeRow({ heuristicFlags: [PerfHeuristicFlag.DRAM_BOUND], hasUtilisationUnknownNote: true })}
            />,
        );

        const tags = screen
            .getByTestId(TEST_IDS.PERF_HEURISTIC_FLAGS)
            .querySelectorAll(
                `[data-testid="${TEST_IDS.PERF_HEURISTIC_FLAG}"], [data-testid="${TEST_IDS.PERF_UTILISATION_UNKNOWN}"]`,
            );

        expect([...tags].map((tag) => tag.getAttribute('data-testid'))).toEqual([
            TEST_IDS.PERF_HEURISTIC_FLAG,
            TEST_IDS.PERF_UTILISATION_UNKNOWN,
        ]);
    });

    it("reaches the Flags column's cell for a placeholder row", () => {
        const [row] = annotatePerfHeuristicFlags(
            [makeRow({ total_percent: 5, bound: null, pm_ideal_ns: 1, device_time: 127, cores: 64 })],
            64,
        );

        render(<>{formatCell(row, Columns.find((column) => column.key === ColumnKeys.Flags)!)}</>);

        expect(screen.getByTestId(TEST_IDS.PERF_UTILISATION_UNKNOWN)).toBeInTheDocument();
    });

    it.each(Object.values(PerfHeuristicFlag))('renders the source of the %s flag', (flag) => {
        const { source } = PERF_HEURISTIC_FLAG_DEFINITIONS[flag];

        render(<PerfHeuristicFlags row={makeRow({ heuristicFlags: [flag] })} />);

        expect(screen.getByTestId(TEST_IDS.PERF_HEURISTIC_FLAG)).toHaveAttribute('data-source', source);
        expect(
            within(screen.getByTestId('tooltip-content')).getByText(PERF_HEURISTIC_FLAG_SOURCE_LABELS[source]),
        ).toBeInTheDocument();
    });
});

describe('PERF_HEURISTIC_FLAG_DEFINITIONS', () => {
    it('attributes each flag to the report it comes from', () => {
        const sourceByFlag = Object.fromEntries(
            Object.entries(PERF_HEURISTIC_FLAG_DEFINITIONS).map(([flag, { source }]) => [flag, source]),
        );

        expect(sourceByFlag).toEqual({
            [PerfHeuristicFlag.DRAM_BOUND]: PerfHeuristicFlagSource.PERF_REPORT,
            [PerfHeuristicFlag.LOW_UTILISATION]: PerfHeuristicFlagSource.PERF_REPORT,
            [PerfHeuristicFlag.UNDERUTILISED_CORES]: PerfHeuristicFlagSource.PERF_REPORT,
            [PerfHeuristicFlag.RECOMPUTE_CANDIDATE]: PerfHeuristicFlagSource.PERF_REPORT,
            [PerfHeuristicFlag.ALLOCATION_FAILURE]: PerfHeuristicFlagSource.MEMORY_REPORT_RECORDED,
            [PerfHeuristicFlag.DRAM_FALLBACK]: PerfHeuristicFlagSource.MEMORY_REPORT_INFERRED,
        });
    });
});
