// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, test } from 'vitest';
import { semverParse } from '../src/functions/semverParse';

const VERSION_0 = { major: 0, minor: 0, patch: 0 };

describe('semverParse', () => {
    test.each([
        ['undefined', undefined],
        ['an empty string', ''],
        ['unparseable input', 'garbage'],
        ['a v-prefixed tag', 'v1.2.3'],
        ['a PEP 440 dev release', '1.0.0.dev0'],
        ['a PEP 440 prerelease', '1.0.0rc1'],
        ['a PEP 440 post release', '1.0.0.post1'],
    ])('falls back to 0.0.0 for %s', (_case, version) => {
        expect(semverParse(version)).toEqual(VERSION_0);
    });

    test('never returns nullish, so callers may read components unguarded', () => {
        // getVersionOutdatedLevel and useAPI's schema_version check both dereference the result
        // without a null check; loosening the return type to SemVer | null would break them silently.
        expect(semverParse('garbage')).not.toBeNull();
        expect(semverParse(undefined)).not.toBeUndefined();
    });

    test('parses a full version', () => {
        expect(semverParse('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    test('defaults omitted minor and patch components to zero', () => {
        expect(semverParse('1')).toEqual({ major: 1, minor: 0, patch: 0 });
        expect(semverParse('1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
    });

    test('captures a hyphenated prerelease identifier', () => {
        expect(semverParse('1.2.3-rc1')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: 'rc1' });
    });

    test('omits the prerelease key when there is no prerelease', () => {
        expect(semverParse('1.2.3')).not.toHaveProperty('prerelease');
    });
});
