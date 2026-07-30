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
    ])('local %s against published %s reports level %i', (current, latest, expected) => {
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
        ['missing local version', undefined, '0.96.0'],
        ['missing published version', '0.96.0', undefined],
        ['empty local version', '', '0.96.0'],
        ['empty published version', '0.96.0', ''],
        ['both versions missing', undefined, undefined],
    ])('reports NONE with a %s', (_case, current, latest) => {
        expect(getVersionOutdatedLevel(current, latest)).toBe(OutdatedLevel.NONE);
    });

    test('treats omitted minor and patch components as zero', () => {
        expect(getVersionOutdatedLevel('1', '1.0.0')).toBe(OutdatedLevel.NONE);
        expect(getVersionOutdatedLevel('1.0', '1.0.1')).toBe(OutdatedLevel.ONE);
    });

    test('ignores prerelease identifiers, so a local rc reports as its release', () => {
        expect(getVersionOutdatedLevel('1.0.0-rc1', '1.0.0')).toBe(OutdatedLevel.NONE);
        expect(getVersionOutdatedLevel('1.0.0-rc1', '1.0.1')).toBe(OutdatedLevel.ONE);
    });
});
