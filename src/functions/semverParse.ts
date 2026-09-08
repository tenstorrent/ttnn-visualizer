// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface SemVer {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
}

export const semverParse = (version: string | undefined): SemVer => {
    const VERSION_0 = { major: 0, minor: 0, patch: 0 };
    if (!version) {
        return VERSION_0;
    }

    const regex = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\w.-]+))?$/;
    const match = version.match(regex);

    if (!match) {
        return VERSION_0;
    }

    const [, major, minor, patch, prerelease] = match;

    return {
        major: parseInt(major, 10),
        minor: minor ? parseInt(minor, 10) : 0,
        patch: patch ? parseInt(patch, 10) : 0,
        ...(prerelease ? { prerelease } : {}),
    };
};
