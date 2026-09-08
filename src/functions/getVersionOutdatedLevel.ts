// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { OutdatedLevel } from '../definitions/Versions';
import { semverParse } from './semverParse';

/**
 * Compares (major, minor, patch) as an ordered triple. PyPI's release feed lags a freshly tagged
 * release, so a local build ahead of the published one is routine and must report NONE.
 *
 * Hyphenated prereleases compare equal to their release: a local 1.0.0-rc1 is not prompted towards
 * 1.0.0, because prompting every dev build to "update" to the version it already contains is worse
 * noise than the missed prompt. Only the local side can carry a prerelease — the published version
 * is regex-constrained to \d+\.\d+\.\d+ in views.get_latest_version — which is where suppressing
 * the prompt is the right policy. Non-hyphenated PEP 440 spellings (1.0.0rc1, 1.0.0.dev0) miss
 * semverParse's regex and degrade to 0.0.0, so they would invert this; unreachable while the local
 * version comes from package.json via import.meta.env.APP_VERSION.
 */
export const getVersionOutdatedLevel = (
    appVersion: string | undefined,
    latestAppVersion: string | undefined,
): OutdatedLevel => {
    if (!appVersion || !latestAppVersion) {
        return OutdatedLevel.NONE;
    }

    const current = semverParse(appVersion);
    const latest = semverParse(latestAppVersion);
    const majorDiff = latest.major - current.major;

    if (majorDiff !== 0) {
        return majorDiff > 0 ? OutdatedLevel.THREE : OutdatedLevel.NONE;
    }

    const minorDiff = latest.minor - current.minor;

    if (minorDiff !== 0) {
        if (minorDiff < 0) {
            return OutdatedLevel.NONE;
        }

        if (minorDiff === 1) {
            return OutdatedLevel.ONE;
        }

        return minorDiff === 2 ? OutdatedLevel.TWO : OutdatedLevel.THREE;
    }

    return latest.patch > current.patch ? OutdatedLevel.ONE : OutdatedLevel.NONE;
};
