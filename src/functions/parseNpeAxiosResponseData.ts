// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError } from 'axios';
import { NPEAxiosErrorCode } from '../definitions/NPEData';
import { NPEData } from '../model/NPEModel';

const throwNpeAxiosError = (message: string, code: NPEAxiosErrorCode): never => {
    const error = new AxiosError(message);
    error.code = code;
    throw error;
};

/**
 * Turn an axios NPE response body into `NPEData`.
 *
 * Axios defaults to silent JSON parsing: on SyntaxError it leaves `data` as the
 * raw string. Empty/null bodies and malformed JSON are mapped to INVALID_JSON
 * so the UI does not fall through to a misleading "Invalid NPE data" validation
 * error.
 */
export const parseNpeAxiosResponseData = (data: unknown): NPEData => {
    if (data === null || data === undefined || data === '') {
        throwNpeAxiosError('NPE response body was empty', NPEAxiosErrorCode.INVALID_JSON);
    }

    if (typeof data === 'string') {
        try {
            return JSON.parse(data) as NPEData;
        } catch {
            throwNpeAxiosError('Failed to parse NPE response as JSON', NPEAxiosErrorCode.INVALID_JSON);
        }
    }

    if (typeof data !== 'object') {
        throwNpeAxiosError(`Unexpected NPE response type: ${typeof data}`, NPEAxiosErrorCode.INVALID_JSON);
    }

    return data as NPEData;
};
