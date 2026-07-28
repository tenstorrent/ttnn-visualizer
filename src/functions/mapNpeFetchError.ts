// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, HttpStatusCode } from 'axios';
import { NPEAxiosErrorCode, NPEValidationError } from '../definitions/NPEData';

/**
 * Map an Axios failure from an NPE whole-file fetch to a UI validation error.
 * Returns `null` when the error is absent or not an HTTP/transport failure
 * (caller should fall through to payload validation).
 */
export const mapNpeFetchError = (error: AxiosError | null): NPEValidationError | null => {
    if (!error) {
        return null;
    }

    if (
        error.code === NPEAxiosErrorCode.INVALID_JSON ||
        error.code === AxiosError.ERR_BAD_RESPONSE ||
        error.status === HttpStatusCode.UnprocessableEntity
    ) {
        return NPEValidationError.INVALID_JSON;
    }

    if (error.status !== undefined && error.status >= HttpStatusCode.BadRequest) {
        return NPEValidationError.DEFAULT;
    }

    return null;
};
