// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, test } from 'vitest';
import { getVersionOutdatedLevel } from '../src/functions/getVersionOutdatedLevel';
import { OutdatedLevel } from '../src/definitions/Versions';

describe('getVersionOutdatedLevel', () => {
    test.each([
        ['0.96.0', '0.96.0', OutdatedLevel.NONE],
        ['0.96.0', '0.96.1', OutdatedLevel.ONE],
        ['0.96.0', '0.97.0', OutdatedLevel.ONE],
        ['0.96.0', '0.98.0', OutdatedLevel.TWO],
        ['0.96.0', '0.99.0', OutdatedLevel.THREE],
        ['0.96.0', '1.0.0', OutdatedLevel.THREE],
        ['0.96.5', '0.97.0', OutdatedLevel.ONE],
    ])('reports level %#: local %s against published %s', (current, latest, expected) => {
        expect(getVersionOutdatedLevel(current, latest)).toBe(expected);
    });

    test.each([
        ['0.96.0', '0.95.1'],
        ['0.96.1', '0.96.0'],
        ['1.0.0', '0.99.5'],
        ['2.5.0', '1.6.0'],
        ['0.97.0', '0.96.5'],
    ])('reports NONE for local %s ahead of published %s', (current, latest) => {
        expect(getVersionOutdatedLevel(current, latest)).toBe(OutdatedLevel.NONE);
    });

    test.each([
        ['', '0.96.0'],
        ['0.96.0', ''],
        ['', ''],
    ])('reports NONE when a version is missing (%s, %s)', (current, latest) => {
        expect(getVersionOutdatedLevel(current, latest)).toBe(OutdatedLevel.NONE);
    });

    test('treats omitted minor and patch components as zero', () => {
        expect(getVersionOutdatedLevel('1', '1.0.0')).toBe(OutdatedLevel.NONE);
        expect(getVersionOutdatedLevel('1.0', '1.0.1')).toBe(OutdatedLevel.ONE);
    });
});
