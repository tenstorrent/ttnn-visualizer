// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { SemVer } from './semverParse';
import { TARGET_DB_VERSION_MAX, TARGET_DB_VERSION_MIN } from '../definitions/Versions';

export enum DBVersionValidation {
    OK,
    DB_OLD,
    DB_NEW,
}
const semverToString = (version: SemVer) => {
    return `${version.major}.${version.minor}.${version.patch}`;
};
export const evaluateDbVersion = (version: SemVer) => {
    if (version.major > TARGET_DB_VERSION_MAX) {
        return {
            statusCode: DBVersionValidation.DB_NEW,
            message: `The uploaded report was generated with a newer version of the tt-metal  (report v${semverToString(version)}) and may not display correctly. Please update the visualizer to the latest version to ensure full compatibility.`,
        };
    }
    if (version.major < TARGET_DB_VERSION_MIN) {
        return {
            statusCode: DBVersionValidation.DB_OLD,
            message: `The uploaded report was generated with an older version of the tt-metal (report v${semverToString(version)}) and may not display correctly. Please update the tt-metal to the latest to ensure full compatibility.`,
        };
    }
    return {
        statusCode: DBVersionValidation.OK,
    };
};
