// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { OutdatedLevel } from '../definitions/Versions';
import { semverParse } from './semverParse';

const MINOR_DIFF_LEVEL_ONE = 1;
const MINOR_DIFF_LEVEL_TWO = 2;

/**
 * Compares (major, minor, patch) as an ordered triple. PyPI's release feed lags a freshly tagged
 * release, so a local build ahead of the published one is routine and must report NONE.
 */
export const getVersionOutdatedLevel = (appVersion: string, latestAppVersion: string): OutdatedLevel => {
    if (!appVersion || !latestAppVersion) {
        return OutdatedLevel.NONE;
    }

    const current = semverParse(appVersion);
    const latest = semverParse(latestAppVersion);

    if (latest.major !== current.major) {
        return latest.major > current.major ? OutdatedLevel.THREE : OutdatedLevel.NONE;
    }

    if (latest.minor !== current.minor) {
        if (latest.minor < current.minor) {
            return OutdatedLevel.NONE;
        }

        const minorDiff = latest.minor - current.minor;

        if (minorDiff === MINOR_DIFF_LEVEL_ONE) {
            return OutdatedLevel.ONE;
        }

        return minorDiff === MINOR_DIFF_LEVEL_TWO ? OutdatedLevel.TWO : OutdatedLevel.THREE;
    }

    return latest.patch > current.patch ? OutdatedLevel.ONE : OutdatedLevel.NONE;
};
