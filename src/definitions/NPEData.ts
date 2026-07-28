// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const MIN_SUPPORTED_VERSION = '1.0.0';
export const LEGACY_VISUALIZER_VERSION = '0.32.3'; // Version of the visualizer that supports pre-version data format

// Axios timeout for GET /api/npe (download wait; sync JSON.parse is separate).
export const NPE_FETCH_TIMEOUT_MS = 30_000;

/**
 * Intended Axios response/body size cap (~Chromium 512 MiB string limit).
 * Passed on NPE GETs for http/fetch adapter parity; the SPA xhr adapter does not enforce it.
 */
export const NPE_MAX_CONTENT_LENGTH = 512 * 1024 * 1024;

export const NPE_PROCESSING_LABEL = 'Processing NPE…';

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
}
