// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios, { HttpStatusCode } from 'axios';

/** HTTP status of a failed request, or `undefined` for anything that is not an axios error. */
export default function getErrorStatus(error: unknown): number | undefined {
    if (!axios.isAxiosError(error)) {
        return undefined;
    }

    return error.status ?? error.response?.status;
}

/**
 * The API refuses a signpost range the performance report cannot honour with a 400. `Range`
 * drops the range and keeps the report, and the load recorder waits for the refetch, so both
 * must agree on what a refusal is.
 */
export const isRefusedSignpostRange = (error: unknown, hasSignpostRange: boolean): boolean =>
    hasSignpostRange && getErrorStatus(error) === HttpStatusCode.BadRequest;
