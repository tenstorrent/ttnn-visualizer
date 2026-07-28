// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { AxiosError, HttpStatusCode } from 'axios';
import { NPEAxiosErrorCode, NPEValidationError } from '../src/definitions/NPEData';
import { mapNpeFetchError } from '../src/functions/mapNpeFetchError';

describe('mapNpeFetchError', () => {
    it('returns null when there is no error', () => {
        expect(mapNpeFetchError(null)).toBeNull();
    });

    it('maps INVALID_JSON, ERR_BAD_RESPONSE, and 422 to INVALID_JSON', () => {
        const invalidJson = new AxiosError('bad json');
        invalidJson.code = NPEAxiosErrorCode.INVALID_JSON;
        expect(mapNpeFetchError(invalidJson)).toBe(NPEValidationError.INVALID_JSON);

        const badResponse = new AxiosError('bad response');
        badResponse.code = AxiosError.ERR_BAD_RESPONSE;
        expect(mapNpeFetchError(badResponse)).toBe(NPEValidationError.INVALID_JSON);

        const unprocessable = new AxiosError('422');
        unprocessable.status = HttpStatusCode.UnprocessableEntity;
        expect(mapNpeFetchError(unprocessable)).toBe(NPEValidationError.INVALID_JSON);
    });

    it('maps other HTTP failures to DEFAULT', () => {
        const error = new AxiosError('server error');
        error.status = HttpStatusCode.InternalServerError;
        expect(mapNpeFetchError(error)).toBe(NPEValidationError.DEFAULT);
    });

    it('returns null for non-HTTP Axios errors so payload validation can run', () => {
        const error = new AxiosError('network blip');
        expect(mapNpeFetchError(error)).toBeNull();
    });
});
