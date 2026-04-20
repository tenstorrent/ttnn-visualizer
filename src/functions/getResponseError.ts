// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from 'axios';

const DEFAULT_ERROR_MESSAGE = 'An unexpected error occurred';

/**
 * Extracts a user-facing error message from an unknown error value.
 * Handles AxiosError responses (expecting { error: string } from the backend),
 * standard Error objects, and string errors.
 */
export default function getResponseError(error: unknown, fallback: string = DEFAULT_ERROR_MESSAGE): string {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data;

        if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
            return data.error;
        }

        if (typeof data === 'string' && data.length > 0) {
            return data;
        }

        return error.message || fallback;
    }

    if (error instanceof Error) {
        return error.message || fallback;
    }

    if (typeof error === 'string' && error.length > 0) {
        return error;
    }

    return fallback;
}
