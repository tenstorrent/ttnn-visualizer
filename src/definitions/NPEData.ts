// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { semverParse } from '../functions/semverParse';
import { NPEData } from '../model/NPEModel';

export const MIN_SUPPORTED_VERSION = '1.0.0';
export const LEGACY_VISUALIZER_VERSION = '0.32.3'; // Version of the visualizer that supports pre-version data format

export enum NPEValidationError {
    OK,
    DEFAULT,
    INVALID_NPE_VERSION,
    INVALID_JSON,
    INVALID_NPE_DATA,
    EMPTY_NPE_TRACE,
}

export const validateNpeData = (data: unknown): NPEValidationError => {
    if (typeof data !== 'object' || data === null) {
        return NPEValidationError.INVALID_NPE_DATA;
    }

    const npeData = data as NPEData;
    const dataVersion = npeData?.common_info?.version || null;
    const requiredKeys: (keyof NPEData)[] = ['common_info', 'noc_transfers', 'timestep_data'];
    const hasAllKeys = requiredKeys.every((key) => key in npeData);

    if (!hasAllKeys) {
        return NPEValidationError.INVALID_NPE_DATA;
    }

    // Reject traces with no transfers or no timesteps. The trace itself is well-formed,
    // but NPEViewComponent dereferences `timestep_data[selectedTimestep].active_transfers`
    // and crashes if either is empty. This is a distinct condition from malformed data —
    // the producer completed but captured no activity.
    if (
        !Array.isArray(npeData.noc_transfers) ||
        !Array.isArray(npeData.timestep_data) ||
        npeData.noc_transfers.length === 0 ||
        npeData.timestep_data.length === 0
    ) {
        return NPEValidationError.EMPTY_NPE_TRACE;
    }

    const parsedVersion = dataVersion ? semverParse(dataVersion) : null;

    if (!parsedVersion) {
        return NPEValidationError.INVALID_NPE_VERSION;
    }

    const minSupportedVersion = semverParse(MIN_SUPPORTED_VERSION);

    if (!minSupportedVersion || parsedVersion.major !== minSupportedVersion.major) {
        return NPEValidationError.INVALID_NPE_VERSION;
    }

    return NPEValidationError.OK;
};
