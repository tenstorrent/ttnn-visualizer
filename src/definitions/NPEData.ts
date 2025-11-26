// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { HttpStatusCode } from 'axios';
import { semverParse } from '../functions/semverParse';
import { NPEData } from '../model/NPEModel';

export const MIN_SUPPORTED_VERSION = '1.0.0';
export const LEGACY_VISUALIZER_VERSION = '0.32.3'; // Version of the visualizer that supports pre-version data format

// NPE data processing error codes
export enum ErrorCodes {
    DEFAULT,
    INVALID_NPE_VERSION,
    INVALID_JSON,
    INVALID_NPE_DATA,
}

export const ProcessingErrors: Record<ErrorCodes, { title: string }> = {
    [ErrorCodes.DEFAULT]: {
        title: 'Unknown error',
    },
    [ErrorCodes.INVALID_NPE_VERSION]: {
        title: 'Invalid NPE version',
    },
    [ErrorCodes.INVALID_JSON]: {
        title: 'Unable to process JSON',
    },
    [ErrorCodes.INVALID_NPE_DATA]: {
        title: 'Invalid NPE data',
    },
};

export const getNpeDataErrorType = (
    dataVersion: string | null,
    httpStatus?: HttpStatusCode,
    isValidData?: boolean,
): ErrorCodes => {
    const parsedVersion = dataVersion ? semverParse(dataVersion) : null;

    if (httpStatus === HttpStatusCode.UnprocessableEntity) {
        return ErrorCodes.INVALID_JSON;
    }

    if (isValidData === false) {
        return ErrorCodes.INVALID_NPE_DATA;
    }

    if (!parsedVersion) {
        return ErrorCodes.INVALID_NPE_VERSION;
    }

    return ErrorCodes.DEFAULT;
};

export const isValidNpeData = (data: NPEData): boolean => {
    if (typeof data !== 'object' || data === null || data === undefined) {
        return false;
    }
    const requiredKeys: (keyof NPEData)[] = ['common_info', 'noc_transfers', 'timestep_data'];
    const hasAllKeys = requiredKeys.every((key) => key in data);
    const dataVersion = semverParse(data.common_info.version);
    const minSupportedVersion = semverParse(MIN_SUPPORTED_VERSION);

    if (!hasAllKeys || dataVersion?.major !== minSupportedVersion?.major) {
        return false;
    }

    return true;
};
