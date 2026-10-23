// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    LOW_UTILISATION_UNMODELLED_NOTE,
    annotatePerfHeuristicFlags,
} from '../src/functions/computePerfHeuristicFlags';
import { enrichRowData } from '../src/functions/enrichPerfRowData';
import getCoreUtilization from '../src/functions/getCoreUtilization';
import { DeviceMetaLike, resolveMaxCores } from '../src/functions/getCoreCount';
import { BoundAnalysis, BoundType } from '../src/definitions/PerfTable';
import { PerfHeuristicFlag } from '../src/definitions/PerfHeuristics';
import { PerfTableRow, TypedPerfTableRow } from '../src/model/PerfTable';
import golden from './data/agentPerfFlagsParity.json';

// The agent's Python port (#2193) wrote this golden, from test_agent_perf_flags_parity.py; holding
// the app to it fails a change on either side. Regenerate with `pnpm run agent:parity-golden`.

// The flag and the figures the agent reports it with, in place of the app's display string;
// the row's own fields, such as its cores and program hash, are not repeated.
interface FlagEvidence {
    flag: PerfHeuristicFlag;
    reason?: string;
    dram_percent?: number | null;
    flops_percent?: number | null;
    core_utilisation_percent?: number;
    roofline_modelled?: boolean | null;
    core_capacity?: number;
    core_capacity_from?: string;
}

interface FlagCase {
    rows: unknown[];
    maxCores: number | string;
    flags: FlagEvidence[][];
    utilisation: number[];
}

// The agent rounds a figure to three places, and cuts a utilisation to them.
const FIGURE_DIGITS = 2;
const UTILISATION_PLACE = 1e-3;
const FLOAT_TOLERANCE = 1e-9;

const indexedCases = <T>(cases: T[]) => cases.map((entry, index) => [index, entry] as const);

const typedRows = (rows: unknown[]) => enrichRowData(rows as PerfTableRow[], [], null);

const expectFigure = (figure: number | null | undefined, value: number | null) => {
    if (value === null || !Number.isFinite(value)) {
        expect(figure).toBeNull();
    } else {
        expect(figure).toBeCloseTo(value, FIGURE_DIGITS);
    }
};

const expectEvidence = (row: TypedPerfTableRow, evidence: FlagEvidence, maxCores: number) => {
    const detail = row.heuristicFlagDetails?.[evidence.flag];

    switch (evidence.flag) {
        case PerfHeuristicFlag.DRAM_BOUND:
            if (evidence.reason === 'bound_dram') {
                expect(detail).toBe(`Bound: ${BoundType.DRAM}`);
            } else {
                expect(evidence.reason).toBe('slow_dram_above_flops');
                expect(detail).toMatch(/^DRAM .+ vs FLOPS .+$/);
            }
            expectFigure(evidence.dram_percent, row.dram_percent);
            expectFigure(evidence.flops_percent, row.flops_percent);
            break;
        case PerfHeuristicFlag.LOW_UTILISATION: {
            const cut = getCoreUtilization(row, maxCores) * 100 - (evidence.core_utilisation_percent ?? NaN);

            expect(cut).toBeGreaterThan(-FLOAT_TOLERANCE);
            expect(cut).toBeLessThan(UTILISATION_PLACE + FLOAT_TOLERANCE);
            expect(evidence.roofline_modelled).toBe(
                row.bound_analysis === null ? null : row.bound_analysis !== BoundAnalysis.NONE,
            );
            expect(detail?.includes(LOW_UTILISATION_UNMODELLED_NOTE)).toBe(evidence.roofline_modelled === false);
            break;
        }
        case PerfHeuristicFlag.UNDERUTILISED_CORES:
            expect(detail).toBe(`Cores: ${row.cores} / ${evidence.core_capacity}`);
            expect(evidence.core_capacity_from).toBe(row.available_cores === null ? 'max_cores' : 'available_cores');
            break;
        case PerfHeuristicFlag.RECOMPUTE_CANDIDATE:
            expect(detail).toBe(`Hash: ${row.hash}`);
            break;
        default:
            throw new Error(`the agent ports no ${evidence.flag} flag`);
    }
};

it('the golden covers both functions the agent restates', () => {
    expect(golden.flagCases.length).toBeGreaterThan(0);
    expect(golden.typedCases.length).toBeGreaterThan(0);
    expect(golden.maxCoreCases.length).toBeGreaterThan(0);
});

describe('annotatePerfHeuristicFlags', () => {
    it.each(indexedCases(golden.flagCases as FlagCase[]))(
        'case %i matches the agent',
        (_, { rows, maxCores, flags, utilisation }) => {
            // The golden carries a NaN maximum as the string `Number()` reads.
            const max = Number(maxCores);
            const typed = typedRows(rows);
            const annotated = annotatePerfHeuristicFlags(typed, max);

            expect(annotated.map((row) => row.heuristicFlags)).toEqual(
                flags.map((entries) => entries.map(({ flag }) => flag)),
            );
            expect(typed.map((row) => getCoreUtilization(row, max))).toEqual(utilisation);
            annotated.forEach((row, index) => flags[index].forEach((entry) => expectEvidence(row, entry, max)));
        },
    );
});

describe('annotatePerfHeuristicFlags on typed rows no report row parses to', () => {
    it.each(indexedCases(golden.typedCases))('case %i matches the agent', (_, { row, flags }) => {
        const [annotated] = annotatePerfHeuristicFlags([row as unknown as TypedPerfTableRow], 64);

        expect(annotated.heuristicFlags).toEqual(flags.map(({ flag }) => flag));
    });
});

describe('resolveMaxCores', () => {
    it.each(indexedCases(golden.maxCoreCases))('case %i matches the agent', (_, { deviceMeta, rows, maxCores }) => {
        expect(resolveMaxCores(deviceMeta as DeviceMetaLike | null, typedRows(rows))).toBe(maxCores);
    });
});
