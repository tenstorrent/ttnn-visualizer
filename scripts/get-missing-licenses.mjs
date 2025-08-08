/* eslint-disable no-console */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

const getMissingLicenses = async (missingDeps, depLicenses) => {
    const result = missingDeps.map((name) => ({
        name,
        licenseType: depLicenses[name].license || '',
        licenseFileGuess: getLicenseURL(name, depLicenses),
    }));

    for (const obj of result) {
        if (obj.possibleLicenseFile) {
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
            } catch {
                obj.licenseFileGuess = '';
            }
        }
    }

    if (result.length) {
        console.info(JSON.stringify(result, null, 2));
        console.info(`\n${result.length} missing licenses found\n`);
    }

    console.info('No missing licenses found.\n');
};

const getLicenseURL = (name, depLicenses) => {
    const isGithub = depLicenses[name].homepage?.includes('github.com');

    if (isGithub) {
        const url = new URL(depLicenses[name].homepage);

        return `${url.origin}${url.pathname.replace(/\/$/, '')}/blob/main/LICENSE`;
    }

    return '';
};

export default getMissingLicenses;
