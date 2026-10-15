// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ReportLoadFailureReason } from './EventLogEvent';

export const MIN_SUPPORTED_VERSION = '1.0.0';
export const LEGACY_VISUALIZER_VERSION = '0.32.3'; // Version of the visualizer that supports pre-version data format

// Shared React Query key prefixes for NPE hooks and NPEFileLoader cache bust (#861).
export const NPE_QUERY_KEY = 'fetch-npe';
export const NPE_TIMELINE_QUERY_KEY = 'get-npe-timeline';
export const NPE_SUMMARY_QUERY_KEY = 'npe-summary';
export const NPE_WINDOW_QUERY_KEY = 'npe-window';

// What the NPE view says about the chip's SoC descriptor (#1776, #1847).
export const SOC_DESCRIPTOR_UNUSABLE_TITLE = 'Unusable SoC descriptor in report';
export const SOC_DESCRIPTOR_GRID_MISMATCH_TITLE = 'SoC descriptor does not match this report';
export const UNSUPPORTED_ARCHITECTURE_TITLE = 'Unsupported architecture';
export const NO_ETHERNET_OR_PCIE_TAG = 'No Ethernet or PCIe';
export const NO_ETHERNET_OR_PCIE_EXPLANATION =
    'This SoC descriptor lists no Ethernet or PCIe tiles, as on an emulation model.';

export enum NPEValidationError {
    OK,
    DEFAULT,
    INVALID_NPE_VERSION,
    INVALID_JSON,
    INVALID_NPE_DATA,
    EMPTY_NPE_TRACE,
}

export const NPE_LOAD_FAILURE_REASON_BY_VALIDATION_ERROR: Record<NPEValidationError, ReportLoadFailureReason | null> = {
    [NPEValidationError.OK]: null,
    [NPEValidationError.DEFAULT]: null,
    [NPEValidationError.INVALID_NPE_VERSION]: ReportLoadFailureReason.UNSUPPORTED_VERSION,
    [NPEValidationError.INVALID_JSON]: ReportLoadFailureReason.PARSE_ERROR,
    [NPEValidationError.INVALID_NPE_DATA]: ReportLoadFailureReason.PARSE_ERROR,
    [NPEValidationError.EMPTY_NPE_TRACE]: ReportLoadFailureReason.OTHER,
};

/** Discriminant on synthetic client 422 bodies — parse vs shape must not share one UI label. */
export enum NpeClientErrorKind {
    PARSE = 'parse',
    SHAPE = 'shape',
}

export interface NpeClientErrorBody {
    kind: NpeClientErrorKind;
}
