// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { parseSocDescriptorOverride } from '../src/functions/socDescriptorOverride';
import archWormhole from '../src/assets/data/arch-wormhole.json';
import archBlackhole from '../src/assets/data/arch-blackhole.json';

// A tensix-only emulation descriptor, the shape the Quasar-IP family produces:
// a grid and workers, and nothing else populated.
const tensixOnly = {
    arch_name: 'QUASAR',
    grid: { x_size: 10, y_size: 8 },
    functional_workers: ['2-2', '3-2', '4-2', '5-2'],
    dram: [['2-7'], ['4-0']],
    arc: [],
    pcie: [],
    eth: [],
};

describe('parseSocDescriptorOverride', () => {
    it('is absent for a report that supplies nothing', () => {
        expect(parseSocDescriptorOverride(undefined).status).toBe('absent');
        expect(parseSocDescriptorOverride(null).status).toBe('absent');
    });

    it('accepts the baked descriptors, so an override is held to the same bar (#1776)', () => {
        // The strongest available check that the rules match reality: whatever the
        // app already renders must validate, or the gate is stricter than the data.
        for (const [name, baked] of [
            ['wormhole', archWormhole],
            ['blackhole', archBlackhole],
        ] as const) {
            const result = parseSocDescriptorOverride(baked);
            expect(result.status, `${name}: ${JSON.stringify(result)}`).toBe('valid');
        }
    });

    it('accepts a tensix-only descriptor with no dram, eth or pcie nodes', () => {
        // Emulation parts legitimately have none. Rejecting them would make the
        // override unusable for exactly the family it exists for.
        const result = parseSocDescriptorOverride({ ...tensixOnly, dram: [], eth: [], pcie: [], arc: [] });

        expect(result.status).toBe('valid');
    });

    it('carries the descriptor through with its own arch name', () => {
        const result = parseSocDescriptorOverride(tensixOnly, 'quasar');

        expect(result.status).toBe('valid');
        if (result.status !== 'valid') {
            return;
        }
        expect(result.design.arch_name).toBe('QUASAR');
        expect(result.design.grid).toEqual({ x_size: 10, y_size: 8 });
        expect(result.design.functional_workers).toHaveLength(4);
    });

    it('labels an unnamed descriptor with the arch the report declared, never a baked one', () => {
        // Reporting a Grendel override as `wormhole` would be a worse answer than
        // an unrecognised name, since the label is displayed.
        const { arch_name: _dropped, ...unnamed } = tensixOnly;
        const result = parseSocDescriptorOverride(unnamed, 'grendel');

        expect(result.status).toBe('valid');
        if (result.status !== 'valid') {
            return;
        }
        expect(result.design.arch_name).toBe('grendel');
    });

    it('fills the optional node lists so readers can treat them as present', () => {
        const result = parseSocDescriptorOverride({
            grid: { x_size: 4, y_size: 4 },
            functional_workers: ['1-1'],
            dram: [],
        });

        expect(result.status).toBe('valid');
        if (result.status !== 'valid') {
            return;
        }
        expect(result.design.eth).toEqual([]);
        expect(result.design.pcie).toEqual([]);
        expect(result.design.arc).toEqual([]);
        expect(result.design.router_only).toEqual([]);
    });

    it('needs only grid and functional_workers, defaulting every node list', () => {
        // The minimum a producer has to write. `dram` is optional on the same
        // terms as `eth` / `pcie` rather than uniquely required.
        const result = parseSocDescriptorOverride({
            grid: { x_size: 4, y_size: 4 },
            functional_workers: ['1-1', '2-1'],
        });

        expect(result.status).toBe('valid');
        if (result.status !== 'valid') {
            return;
        }
        expect(result.design.dram).toEqual([]);
        expect(result.design.eth).toEqual([]);
    });

    it('reports a malformed grid rather than rendering an empty one', () => {
        const result = parseSocDescriptorOverride({
            grid: { x_size: 0, y_size: 'eight' },
            functional_workers: ['1-1'],
            dram: [],
        });

        expect(result.status).toBe('invalid');
        if (result.status !== 'invalid') {
            return;
        }
        expect(result.problems).toEqual(
            expect.arrayContaining([expect.stringContaining('x_size'), expect.stringContaining('y_size')]),
        );
    });

    it('reports coordinates that are not "x-y", naming how many', () => {
        const result = parseSocDescriptorOverride({
            grid: { x_size: 4, y_size: 4 },
            functional_workers: ['1-1', 'nope', ''],
            dram: [['2-7'], ['bad']],
        });

        expect(result.status).toBe('invalid');
        if (result.status !== 'invalid') {
            return;
        }
        expect(result.problems.join(' ')).toContain('functional_workers');
        expect(result.problems.join(' ')).toContain('2 entries that are');
        expect(result.problems.join(' ')).toContain('dram[1]');
    });

    it('reports an empty worker list, which would draw nothing', () => {
        const result = parseSocDescriptorOverride({
            grid: { x_size: 4, y_size: 4 },
            functional_workers: [],
            dram: [],
        });

        expect(result.status).toBe('invalid');
        if (result.status !== 'invalid') {
            return;
        }
        expect(result.problems.join(' ')).toContain('no grid to render');
    });

    it('reports a descriptor that is not an object at all', () => {
        for (const raw of ['a string', 42, ['an', 'array'], true]) {
            const result = parseSocDescriptorOverride(raw);
            expect(result.status, JSON.stringify(raw)).toBe('invalid');
        }
    });

    it('collects every problem rather than stopping at the first', () => {
        const result = parseSocDescriptorOverride({ grid: null, functional_workers: 'nope', dram: 'nope' });

        expect(result.status).toBe('invalid');
        if (result.status !== 'invalid') {
            return;
        }
        expect(result.problems.length).toBeGreaterThanOrEqual(3);
    });
});
