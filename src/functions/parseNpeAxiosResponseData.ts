// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError } from 'axios';
import { NpeAxiosErrorCode } from '../definitions/NPEData';
import { NPEData } from '../model/NPEModel';

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
        const error = new AxiosError(
            "NPE response body was empty. The file may exceed this browser's maximum string size.",
        );
        error.code = NpeAxiosErrorCode.PAYLOAD_TOO_LARGE;
        throw error;
    }

    if (typeof data === 'string') {
        try {
            return JSON.parse(data) as NPEData;
        } catch {
            // Truncated downloads and oversize Chromium bodies often look like
            // a mid-string SyntaxError rather than a clean empty body.
            const error = new AxiosError('Failed to parse NPE response as JSON');
            error.code = NpeAxiosErrorCode.INVALID_JSON;
            throw error;
        }
    }

    if (typeof data !== 'object') {
        const error = new AxiosError(`Unexpected NPE response type: ${typeof data}`);
        error.code = NpeAxiosErrorCode.INVALID_JSON;
        throw error;
    }

    return data as NPEData;
};
