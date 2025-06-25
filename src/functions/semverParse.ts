// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface SemVer {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
}

export const semverParse = (version: string | undefined): SemVer | null => {
    if (!version) {
        return null;
    }
    const regex = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/;
    const match = version.match(regex);

    if (!match) {
        return null;
    }

    const [, major, minor, patch, prerelease] = match;

    return {
        major: parseInt(major, 10),
        minor: parseInt(minor, 10),
        patch: parseInt(patch, 10),
        ...(prerelease ? { prerelease } : {}),
    };
};
