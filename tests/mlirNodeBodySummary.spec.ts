// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { collectLocationLines, collectShapeLines } from '../src/components/mlir/mlirNodeBodySummary';
import type { IndexedAttr, IndexedPortMetadata } from '../src/components/mlir/mlirGraphTypes';

const attrs = (...pairs: Array<[string, string]>): IndexedAttr[] => pairs.map(([key, value]) => ({ key, value }));

const port = (id: string, ...pairs: Array<[string, string]>): IndexedPortMetadata => ({
    id,
    attrs: attrs(...pairs),
});

describe('collectLocationLines', () => {
    it('returns an empty list when no location attr is present', () => {
        expect(collectLocationLines(attrs(['foo', 'bar'], ['baz', '"qux"']))).toEqual([]);
    });

    it.each([
        ['full_location', 'full_location'],
        ['location', 'location'],
        ['loc', 'loc'],
    ])('surfaces the value of the `%s` attr', (label, key) => {
        expect(collectLocationLines(attrs([key, `"module.py:${label}"`]))).toEqual([`module.py:${label}`]);
    });

    it('honours the key priority order (full_location > location > loc)', () => {
        const result = collectLocationLines(
            attrs(['loc', '"low.py:1"'], ['location', '"mid.py:1"'], ['full_location', '"top.py:1"']),
        );
        expect(result).toEqual(['top.py:1']);
    });

    it('returns an empty list when the location value is empty after stripping quotes', () => {
        expect(collectLocationLines(attrs(['location', '""']))).toEqual([]);
    });

    it('truncates long location values with a trailing ellipsis', () => {
        const long = `${'x'.repeat(80)}`;
        const [line] = collectLocationLines(attrs(['location', `"${long}"`]));
        expect(line.length).toBe(40);
        expect(line.endsWith('…')).toBe(true);
    });

    it('collapses whitespace inside the location value', () => {
        expect(collectLocationLines(attrs(['location', '"foo   bar\n\tbaz"']))).toEqual(['foo bar baz']);
    });
});

describe('collectShapeLines', () => {
    it('returns an empty list for a node with no output ports', () => {
        expect(collectShapeLines([])).toEqual([]);
    });

    it('combines shape and dtype into a single compact line per port', () => {
        const ports = [port('out0', ['shape', '[1, 7, 3072]'], ['dtype', '"f32"'])];
        expect(collectShapeLines(ports)).toEqual(['[1, 7, 3072] f32']);
    });

    it('omits dtype gracefully when a port has shape only', () => {
        expect(collectShapeLines([port('out0', ['shape', '[4, 4]'])])).toEqual(['[4, 4]']);
    });

    it('suppresses `rank`, `__tensor_tag`, `shape`, and `dtype` from the fallback extras', () => {
        // No `shape` on this port ⇒ falls back to the extras join. Any of
        // the suppressed keys must NOT appear in the output so the overlay
        // stays useful for non-tensor ports without leaking layout noise.
        const p = port(
            'out0',
            ['rank', '3'],
            ['__tensor_tag', '%result_7'],
            ['dtype', '"f32"'],
            ['layout', 'row_major'],
        );
        expect(collectShapeLines([p])).toEqual(['layout=row_major']);
    });

    it('produces one line per port, in port order', () => {
        const ports = [
            port('out0', ['shape', '[1]'], ['dtype', '"f32"']),
            port('out1', ['shape', '[2, 2]'], ['dtype', '"bf16"']),
        ];
        expect(collectShapeLines(ports)).toEqual(['[1] f32', '[2, 2] bf16']);
    });

    it('drops ports that carry no shape and no non-suppressed extras', () => {
        expect(collectShapeLines([port('out0', ['rank', '2'], ['__tensor_tag', '%x'])])).toEqual([]);
    });
});
