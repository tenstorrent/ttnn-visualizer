// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { AxiosError } from 'axios';
import { NPEAxiosErrorCode } from '../src/definitions/NPEData';
import { parseNpeAxiosResponseData } from '../src/functions/parseNpeAxiosResponseData';

const validPayload = {
    common_info: { version: '1.0.0' },
    noc_transfers: [{ id: 0 }],
    timestep_data: [{ active_transfers: [] }],
};

describe('parseNpeAxiosResponseData', () => {
    it('returns objects unchanged', () => {
        expect(parseNpeAxiosResponseData(validPayload)).toEqual(validPayload);
    });

    it('parses a JSON string body', () => {
        expect(parseNpeAxiosResponseData(JSON.stringify(validPayload))).toEqual(validPayload);
    });

    it('throws PAYLOAD_TOO_LARGE for empty Chromium-style bodies', () => {
        for (const empty of [null, undefined, '']) {
            try {
                parseNpeAxiosResponseData(empty);
                expect.unreachable();
            } catch (error) {
                expect(error).toBeInstanceOf(AxiosError);
                expect((error as AxiosError).code).toBe(NPEAxiosErrorCode.PAYLOAD_TOO_LARGE);
            }
        }
    });

    it('throws INVALID_JSON for malformed JSON strings', () => {
        try {
            parseNpeAxiosResponseData('{not-json');
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(AxiosError);
            expect((error as AxiosError).code).toBe(NPEAxiosErrorCode.INVALID_JSON);
        }
    });

    it('throws INVALID_JSON for non-object primitives', () => {
        for (const primitive of [123, true]) {
            try {
                parseNpeAxiosResponseData(primitive);
                expect.unreachable();
            } catch (error) {
                expect(error).toBeInstanceOf(AxiosError);
                expect((error as AxiosError).code).toBe(NPEAxiosErrorCode.INVALID_JSON);
            }
        }
    });
});
