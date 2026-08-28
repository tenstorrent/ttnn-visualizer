// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import socDescriptorSchema from '../src/schemas/npe-soc-descriptor.schema.json';
import { parseSocDescriptorOverride } from '../src/functions/socDescriptorOverride';
import archWormhole from '../src/assets/data/arch-wormhole.json';
import archBlackhole from '../src/assets/data/arch-blackhole.json';

const validate = new Ajv({ allErrors: true }).compile(socDescriptorSchema);

/**
 * Descriptors the NPE producers might write, and what both the published schema
 * and the runtime validator must say about each. The point of the table is that
 * one column drives both: a schema the app does not honour is worse than no
 * schema, because a producer would build against it and still be rejected.
 */
const cases: { label: string; descriptor: unknown; accepted: boolean }[] = [
    { label: 'baked wormhole', descriptor: archWormhole, accepted: true },
    { label: 'baked blackhole', descriptor: archBlackhole, accepted: true },
    {
        label: 'minimum a producer must write',
        descriptor: { grid: { x_size: 4, y_size: 4 }, functional_workers: ['1-1'] },
        accepted: true,
    },
    {
        label: 'tensix-only emulation part',
        descriptor: {
            arch_name: 'QUASAR',
            grid: { x_size: 10, y_size: 8 },
            functional_workers: ['2-2', '3-2'],
            dram: [['2-7'], ['4-0']],
            arc: [],
            pcie: [],
            eth: [],
        },
        accepted: true,
    },
    {
        label: 'extra producer-specific keys are passed through',
        descriptor: {
            grid: { x_size: 4, y_size: 4 },
            functional_workers: ['1-1'],
            some_future_field: { anything: true },
        },
        accepted: true,
    },
    { label: 'missing grid', descriptor: { functional_workers: ['1-1'] }, accepted: false },
    { label: 'missing functional_workers', descriptor: { grid: { x_size: 4, y_size: 4 } }, accepted: false },
    {
        label: 'empty functional_workers',
        descriptor: { grid: { x_size: 4, y_size: 4 }, functional_workers: [] },
        accepted: false,
    },
    {
        label: 'zero grid axis',
        descriptor: { grid: { x_size: 0, y_size: 4 }, functional_workers: ['1-1'] },
        accepted: false,
    },
    {
        label: 'non-numeric grid axis',
        descriptor: { grid: { x_size: 4, y_size: 'eight' }, functional_workers: ['1-1'] },
        accepted: false,
    },
    {
        label: 'coordinate not "x-y"',
        descriptor: { grid: { x_size: 4, y_size: 4 }, functional_workers: ['1-1', 'nope'] },
        accepted: false,
    },
    {
        label: 'dram not nested per channel',
        descriptor: { grid: { x_size: 4, y_size: 4 }, functional_workers: ['1-1'], dram: ['2-7'] },
        accepted: false,
    },
    {
        label: 'eth coordinate malformed',
        descriptor: { grid: { x_size: 4, y_size: 4 }, functional_workers: ['1-1'], eth: ['9'] },
        accepted: false,
    },
    {
        label: 'grid axis above the cap',
        descriptor: { grid: { x_size: 1000, y_size: 4 }, functional_workers: ['1-1'] },
        accepted: false,
    },
];

/**
 * Rules draft-07 cannot express, so the schema accepts these and the runtime
 * validator rejects them. Listed rather than omitted: the asymmetry is the
 * contract — passing the schema is necessary, not sufficient — and a producer
 * reading only the schema needs to know these two exist.
 */
const runtimeOnly: { label: string; descriptor: unknown }[] = [
    {
        label: 'worker outside the grid',
        descriptor: { grid: { x_size: 4, y_size: 4 }, functional_workers: ['99-99'] },
    },
    {
        label: 'dram bank outside the grid',
        descriptor: { grid: { x_size: 4, y_size: 4 }, functional_workers: ['1-1'], dram: [['0-40']] },
    },
    {
        label: 'cell count above the cap while both axes are under it',
        descriptor: { grid: { x_size: 200, y_size: 200 }, functional_workers: ['1-1'] },
    },
];

describe('npe-soc-descriptor.schema.json', () => {
    it.each(cases)('$label: schema and runtime validator agree', ({ descriptor, accepted }) => {
        const schemaSays = validate(descriptor);
        const runtimeSays = parseSocDescriptorOverride(descriptor).status === 'valid';

        expect(schemaSays, `schema: ${JSON.stringify(validate.errors)}`).toBe(accepted);
        expect(runtimeSays, 'runtime validator').toBe(accepted);
    });

    it.each(runtimeOnly)('$label: schema cannot catch it, the validator does', ({ descriptor }) => {
        expect(validate(descriptor), 'schema is expected to accept this').toBe(true);
        expect(parseSocDescriptorOverride(descriptor).status).toBe('invalid');
    });

    it('never rejects something the runtime validator would accept', () => {
        // The direction that matters: a producer building to the schema must not be
        // turned away for a reason the schema never mentioned. The reverse is
        // allowed and covered above.
        for (const { descriptor } of [...cases, ...runtimeOnly]) {
            if (parseSocDescriptorOverride(descriptor).status === 'valid') {
                expect(validate(descriptor), `${JSON.stringify(descriptor)}`).toBe(true);
            }
        }
    });

    it('is a valid draft-07 schema that ajv will compile', () => {
        // A schema the producers cannot run is not a contract.
        expect(typeof validate).toBe('function');
        expect(socDescriptorSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    });

    it('rejects a non-object outright, as the runtime validator does', () => {
        for (const raw of ['a string', 42, ['an', 'array'], true]) {
            expect(validate(raw), JSON.stringify(raw)).toBe(false);
            expect(parseSocDescriptorOverride(raw).status).toBe('invalid');
        }
    });
});
