// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const MIN_SUPPORTED_VERSION = '1.0.0';
export const LEGACY_VISUALIZER_VERSION = '0.32.3'; // Version of the visualizer that supports pre-version data format

/** Axios `error.code` values thrown by `parseNpeAxiosResponseData`. */
export enum NPEAxiosErrorCode {
    INVALID_JSON = 'NPE_INVALID_JSON',
}

export enum NPEValidationError {
    OK,
    DEFAULT,
    INVALID_NPE_VERSION,
    INVALID_JSON,
    INVALID_NPE_DATA,
    EMPTY_NPE_TRACE,
}
