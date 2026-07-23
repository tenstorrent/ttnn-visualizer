// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError } from 'axios';
import { NpeAxiosErrorCode } from '../definitions/NPEData';
import { NPEData } from '../model/NPEModel';

const throwNpeAxiosError = (message: string, code: NpeAxiosErrorCode): never => {
    const error = new AxiosError(message);
    error.code = code;
    throw error;
};

/**
 * Turn an axios NPE response body into `NPEData`.
 *
 * Axios defaults to silent JSON parsing: on SyntaxError it leaves `data` as the
 * raw string (or Chromium may hand back null/'' once the max string size is
 * hit). That used to surface as a misleading "Invalid NPE data" validation
 * error in Chrome while Firefox (higher string limit) still worked.
 */
export const parseNpeAxiosResponseData = (data: unknown): NPEData => {
    if (data === null || data === undefined || data === '') {
        throwNpeAxiosError(
            "NPE response body was empty. The file may exceed this browser's maximum string size.",
            NpeAxiosErrorCode.PAYLOAD_TOO_LARGE,
        );
    }

    if (typeof data === 'string') {
        try {
            return JSON.parse(data) as NPEData;
        } catch {
            // Truncated downloads and oversize Chromium bodies often look like
            // a mid-string SyntaxError rather than a clean empty body.
            throwNpeAxiosError('Failed to parse NPE response as JSON', NpeAxiosErrorCode.INVALID_JSON);
        }
    }

    if (typeof data !== 'object') {
        throwNpeAxiosError(`Unexpected NPE response type: ${typeof data}`, NpeAxiosErrorCode.INVALID_JSON);
    }

    return data as NPEData;
};
