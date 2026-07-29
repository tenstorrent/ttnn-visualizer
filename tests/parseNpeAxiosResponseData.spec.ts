// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { parseNpeAxiosResponseData } from '../src/functions/parseNpeAxiosResponseData';
import { minimalValidNpeData } from './helpers/npeFixtures';

describe('parseNpeAxiosResponseData', () => {
    it('returns objects unchanged', () => {
        expect(parseNpeAxiosResponseData(minimalValidNpeData)).toEqual(minimalValidNpeData);
    });

    it('parses a JSON string body', () => {
        expect(parseNpeAxiosResponseData(JSON.stringify(minimalValidNpeData))).toEqual(minimalValidNpeData);
    });

    it('throws for empty bodies', () => {
        for (const empty of [null, undefined, '']) {
            expect(() => parseNpeAxiosResponseData(empty)).toThrow(/empty/);
        }
    });

    it('throws for malformed JSON strings', () => {
        expect(() => parseNpeAxiosResponseData('{not-json')).toThrow(/parse/);
    });

    it('throws for non-object primitives', () => {
        for (const primitive of [123, true]) {
            expect(() => parseNpeAxiosResponseData(primitive)).toThrow(/Unexpected NPE response type/);
        }
    });
});
