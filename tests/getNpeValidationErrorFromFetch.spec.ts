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

    it('maps HTTP 422 to INVALID_JSON', () => {
        const unprocessable = new AxiosError('422');
        unprocessable.status = HttpStatusCode.UnprocessableEntity;
        expect(getNpeValidationErrorFromFetch(unprocessable)).toBe(NPEValidationError.INVALID_JSON);
    });

    it('maps other HTTP failures to DEFAULT even when Axios sets ERR_BAD_RESPONSE', () => {
        const error = new AxiosError('server error');
        error.code = AxiosError.ERR_BAD_RESPONSE;
        error.status = HttpStatusCode.InternalServerError;
        expect(getNpeValidationErrorFromFetch(error)).toBe(NPEValidationError.DEFAULT);
    });

    it('returns null for ERR_BAD_RESPONSE without an HTTP status so payload validation can run', () => {
        const error = new AxiosError('bad response');
        error.code = AxiosError.ERR_BAD_RESPONSE;
        expect(getNpeValidationErrorFromFetch(error)).toBeNull();
    });

    it('returns null for non-HTTP Axios errors so payload validation can run', () => {
        const error = new AxiosError('network blip');
        expect(getNpeValidationErrorFromFetch(error)).toBeNull();
    });
});
