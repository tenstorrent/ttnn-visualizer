// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const MIN_SUPPORTED_VERSION = '1.0.0';
export const LEGACY_VISUALIZER_VERSION = '0.32.3'; // Version of the visualizer that supports pre-version data format

// Axios / UI wall-clock bound for GET /api/npe (download + parse, including sync JSON.parse).
export const NPE_FETCH_TIMEOUT_MS = 30_000;

/** Bound for first paint of NPEView after data is ready (wall clock, including sync work). */
export const NPE_RENDER_TIMEOUT_MS = 30_000;

/** Axios `error.code` values thrown by `parseNpeAxiosResponseData`. */
export enum NpeAxiosErrorCode {
    PAYLOAD_TOO_LARGE = 'NPE_PAYLOAD_TOO_LARGE',
    INVALID_JSON = 'NPE_INVALID_JSON',
}

export enum NPEValidationError {
    OK,
    DEFAULT,
    INVALID_NPE_VERSION,
    INVALID_JSON,
    INVALID_NPE_DATA,
    EMPTY_NPE_TRACE,
    LOAD_TIMEOUT,
    PAYLOAD_TOO_LARGE,
    RENDER_TIMEOUT,
}
