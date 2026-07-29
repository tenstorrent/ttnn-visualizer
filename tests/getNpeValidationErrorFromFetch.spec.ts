// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders, AxiosResponse, HttpStatusCode } from 'axios';
import { NPEValidationError, NpeClientErrorKind } from '../src/definitions/NPEData';
import { getNpeValidationErrorFromFetch } from '../src/functions/getNpeValidationErrorFromFetch';
import { throwNpeClientAxiosError } from '../src/functions/throwNpeClientAxiosError';

const makeStatusError = (status: number, message = 'error'): AxiosError => {
    const error = new AxiosError(message);
    error.status = status;
    return error;
};

const makeOkResponse = (): AxiosResponse => ({
    data: '',
    status: HttpStatusCode.Ok,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
});

describe('getNpeValidationErrorFromFetch', () => {
    it('returns null when there is no error', () => {
        expect(getNpeValidationErrorFromFetch(null)).toBeNull();
    });

    it('maps unmarked HTTP 422 to INVALID_JSON', () => {
        expect(getNpeValidationErrorFromFetch(makeStatusError(HttpStatusCode.UnprocessableEntity, '422'))).toBe(
            NPEValidationError.INVALID_JSON,
        );
    });

    it('maps client PARSE 422 to INVALID_JSON', () => {
        let caught: AxiosError | undefined;
        try {
            throwNpeClientAxiosError('bad json', NpeClientErrorKind.PARSE, makeOkResponse());
        } catch (error) {
            caught = error as AxiosError;
        }
        expect(caught).toBeDefined();
        expect(getNpeValidationErrorFromFetch(caught!)).toBe(NPEValidationError.INVALID_JSON);
    });

    it('maps client SHAPE 422 to INVALID_NPE_DATA', () => {
        let caught: AxiosError | undefined;
        try {
            throwNpeClientAxiosError('bad shape', NpeClientErrorKind.SHAPE, makeOkResponse());
        } catch (error) {
            caught = error as AxiosError;
        }
        expect(caught).toBeDefined();
        expect(getNpeValidationErrorFromFetch(caught!)).toBe(NPEValidationError.INVALID_NPE_DATA);
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
