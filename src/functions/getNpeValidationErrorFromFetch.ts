// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, HttpStatusCode } from 'axios';
import { NPEValidationError } from '../definitions/NPEData';

/**
 * Map an Axios failure from an NPE whole-file or timeline fetch to a UI
 * validation error. Returns `null` when the error is absent or not an
 * HTTP/transport failure (caller should fall through to payload validation).
 *
 * Prefer status over Axios `code`: real 4xx/5xx responses often set
 * `ERR_BAD_RESPONSE`, which must not be labelled as invalid JSON.
 */
export const getNpeValidationErrorFromFetch = (error: AxiosError | null): NPEValidationError | null => {
    if (!error) {
        return null;
    }

    if (error.status === HttpStatusCode.UnprocessableEntity) {
        return NPEValidationError.INVALID_JSON;
    }

    if (error.status !== undefined && error.status >= HttpStatusCode.BadRequest) {
        return NPEValidationError.DEFAULT;
    }

    return null;
};
