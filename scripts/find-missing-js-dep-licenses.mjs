/* eslint-disable no-console */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

const findMissingDepLicenses = async (missingDeps, depLicenses) => {
    const result = missingDeps.map((name) => {
        const entry = depLicenses?.[name];

        if (!entry) {
            console.warn(
                `No license metadata found for "${name}". This usually means the package is declared in package.json but missing from pnpm-lock.yaml; run \`pnpm install\` and try again.`,
            );
        }

        return {
            name,
            licenseType: entry?.license || '',
            licenseFileGuess: getLicenseURL(name, depLicenses),
        };
    });

    for (const obj of result) {
        if (obj.licenseFileGuess) {
            try {
                // eslint-disable-next-line no-await-in-loop
                let res = await fetch(obj.licenseFileGuess, { method: 'HEAD' });
                if (!res.ok) {
                    // Try with .md appended
                    const altUrlMd = `${obj.licenseFileGuess}.md`;
                    // eslint-disable-next-line no-await-in-loop
                    res = await fetch(altUrlMd, { method: 'HEAD' });
                    if (res.ok) {
                        obj.licenseFileGuess = altUrlMd;
                    } else {
                        const altUrlTxt = `${obj.licenseFileGuess}.txt`;
                        // eslint-disable-next-line no-await-in-loop
                        res = await fetch(altUrlTxt, { method: 'HEAD' });
                        if (res.ok) {
                            obj.licenseFileGuess = altUrlTxt;
                        } else {
                            obj.licenseFileGuess = '';
                        }
                    }
                }
            } catch (err) {
                console.error(`Error fetching license file for "${obj.name}" at "${obj.licenseFileGuess}":`, err);
                obj.licenseFileGuess = '';
            }
        }
    }

    if (result.length) {
        console.error(JSON.stringify(result, null, 2));
        console.error(`\n${result.length} missing licenses found\n`);

        return false;
    }

    console.info('No missing licenses found.\n');

    return true;
};

const getLicenseURL = (name, depLicenses) => {
    const homepage = depLicenses?.[name]?.homepage;

    if (!homepage?.includes('github.com')) {
        return '';
    }

    try {
        const url = new URL(homepage);

        return `${url.origin}${url.pathname.replace(/\/$/, '')}/blob/main/LICENSE`;
    } catch (err) {
        console.error(`Invalid homepage URL for "${name}": ${homepage}`, err);

        return '';
    }
};

export default findMissingDepLicenses;
