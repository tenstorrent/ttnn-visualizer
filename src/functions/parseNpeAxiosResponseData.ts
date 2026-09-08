// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NPEData } from '../model/NPEModel';

/**
 * Turn an axios NPE response body into `NPEData`.
 *
 * Axios defaults to silent JSON parsing: on SyntaxError it leaves `data` as the
 * raw string. Empty/null bodies and malformed JSON throw so `fetchNpeText` can
 * wrap them as a synthetic 422 AxiosError (CONVENTIONS.md) instead of falling
 * through to a misleading "Invalid NPE data" validation error.
 */
export const parseNpeAxiosResponseData = (data: unknown): NPEData => {
    if (data === null || data === undefined || data === '') {
        throw new Error('NPE response body was empty');
    }

    if (typeof data === 'string') {
        try {
            return JSON.parse(data) as NPEData;
        } catch {
            throw new Error('Failed to parse NPE response as JSON');
        }
    }

    if (typeof data !== 'object') {
        throw new Error(`Unexpected NPE response type: ${typeof data}`);
    }

    return data as NPEData;
};
