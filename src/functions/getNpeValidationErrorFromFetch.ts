// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, HttpStatusCode } from 'axios';
import { NPEValidationError, NpeClientErrorBody, NpeClientErrorKind } from '../definitions/NPEData';

export const getNpeClientErrorKind = (error: AxiosError): NpeClientErrorKind | null => {
    const body = error.response?.data;
    if (body == null || typeof body !== 'object') {
        return null;
    }

    const { kind } = body as NpeClientErrorBody;
    if (kind === NpeClientErrorKind.PARSE || kind === NpeClientErrorKind.SHAPE) {
        return kind;
    }

    return null;
};

/**
 * Map an Axios failure from an NPE fetch to a UI validation error. Returns `null`
 * when the error is absent or not an HTTP/transport failure (caller should fall
 * through to payload validation).
 *
 * Prefer status over Axios `code`: real 4xx/5xx responses often set
 * `ERR_BAD_RESPONSE`, which must not be labelled as invalid JSON.
 * Client 422s carry NpeClientErrorKind so shape failures are not INVALID_JSON.
 */
export const getNpeValidationErrorFromFetch = (error: AxiosError | null): NPEValidationError | null => {
    if (!error) {
        return null;
    }

    if (error.status === HttpStatusCode.UnprocessableEntity) {
        if (getNpeClientErrorKind(error) === NpeClientErrorKind.SHAPE) {
            return NPEValidationError.INVALID_NPE_DATA;
        }

        // PARSE marker or unmarked server 422 → invalid JSON (whole-file contract).
        return NPEValidationError.INVALID_JSON;
    }

    if (error.status !== undefined && error.status >= HttpStatusCode.BadRequest) {
        return NPEValidationError.DEFAULT;
    }

    return null;
};
