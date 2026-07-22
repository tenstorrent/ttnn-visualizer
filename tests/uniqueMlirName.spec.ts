// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import uniqueMlirName from '../src/functions/uniqueMlirName';

describe('uniqueMlirName', () => {
    it('returns the base name when the set is empty', () => {
        const used = new Set<string>();
        expect(uniqueMlirName('model', used)).toBe('model');
    });

    it('adds the chosen name to the used set', () => {
        const used = new Set<string>();
        uniqueMlirName('model', used);
        expect(used.has('model')).toBe(true);
    });

    it('appends (2) when the base name is already used', () => {
        const used = new Set(['model']);
        expect(uniqueMlirName('model', used)).toBe('model (2)');
    });

    it('increments the counter until a unique name is found', () => {
        const used = new Set(['model', 'model (2)', 'model (3)']);
        expect(uniqueMlirName('model', used)).toBe('model (4)');
    });

    it('disambiguates two same-stem files loaded in a batch', () => {
        const used = new Set<string>();
        const first = uniqueMlirName('model', used);
        const second = uniqueMlirName('model', used);

        expect(first).toBe('model');
        expect(second).toBe('model (2)');
        expect(first).not.toBe(second);
    });

    it('disambiguates three same-stem files loaded in a batch', () => {
        const used = new Set<string>();
        const names = ['model.json', 'model.mlir', 'model.pb'].map((filename) => {
            const stem = filename.replace(/\.[^/.]+$/, '');
            return uniqueMlirName(stem, used);
        });

        expect(names).toEqual(['model', 'model (2)', 'model (3)']);
    });

    it('does not affect stems that are already distinct', () => {
        const used = new Set<string>();
        const a = uniqueMlirName('stablehlo', used);
        const b = uniqueMlirName('ttir', used);

        expect(a).toBe('stablehlo');
        expect(b).toBe('ttir');
    });

    it('falls back to "model" when base is an empty string', () => {
        const used = new Set<string>();
        expect(uniqueMlirName('', used)).toBe('model');
    });
});
