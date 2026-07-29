// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const MIN_SUPPORTED_VERSION = '1.0.0';
export const LEGACY_VISUALIZER_VERSION = '0.32.3'; // Version of the visualizer that supports pre-version data format

// Shared so NPEFileLoader can bust the same React Query caches the hooks use
// without importing useAPI (AGENTS.md). #861.
export const NPE_QUERY_KEY = 'fetch-npe';
export const NPE_SUMMARY_QUERY_KEY = 'npe-summary';
export const NPE_WINDOW_QUERY_KEY = 'npe-window';

export enum NPEValidationError {
    OK,
    DEFAULT,
    INVALID_NPE_VERSION,
    INVALID_JSON,
    INVALID_NPE_DATA,
    EMPTY_NPE_TRACE,
}
