// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { AxiosError, HttpStatusCode } from 'axios';
import { NPEValidationError } from '../src/definitions/NPEData';
import { getNpeValidationErrorFromFetch } from '../src/functions/getNpeValidationErrorFromFetch';

describe('getNpeValidationErrorFromFetch', () => {
    it('returns null when there is no error', () => {
        expect(getNpeValidationErrorFromFetch(null)).toBeNull();
    });

    it('maps ERR_BAD_RESPONSE and 422 to INVALID_JSON', () => {
        const badResponse = new AxiosError('bad response');
        badResponse.code = AxiosError.ERR_BAD_RESPONSE;
        expect(getNpeValidationErrorFromFetch(badResponse)).toBe(NPEValidationError.INVALID_JSON);

        const unprocessable = new AxiosError('422');
        unprocessable.status = HttpStatusCode.UnprocessableEntity;
        expect(getNpeValidationErrorFromFetch(unprocessable)).toBe(NPEValidationError.INVALID_JSON);
    });

    it('maps other HTTP failures to DEFAULT', () => {
        const error = new AxiosError('server error');
        error.status = HttpStatusCode.InternalServerError;
        expect(getNpeValidationErrorFromFetch(error)).toBe(NPEValidationError.DEFAULT);
    });

    it('returns null for non-HTTP Axios errors so payload validation can run', () => {
        const error = new AxiosError('network blip');
        expect(getNpeValidationErrorFromFetch(error)).toBeNull();
    });
});
