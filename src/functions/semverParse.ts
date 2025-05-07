export interface SemVer {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
}

export const semverParse = (version: string): SemVer | null => {
    const regex = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/;
    if (!version) {
        return null;
    }
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
