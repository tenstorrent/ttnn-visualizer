/* eslint-disable no-console */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import fs, { readFileSync } from 'fs';
import findMissingJsDepLicenses from './find-missing-js-dep-licenses.mjs';

const LICENSE_REGEX = /^-\s+([^\s–]+)\s*-\s*([^-–]+?(?: or [^-–]+)?)\s*-\s*(.+\S[^-])$/gm;

const checkMissingDepLicenses = () => {
    const packages = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const directDeps = [...Object.keys(packages.dependencies || {}), ...Object.keys(packages.devDependencies || {})];
    const licenseFile = fs.readFileSync('LICENSE', 'utf8');
    let input = '';

    process.stdin.on('data', (chunk) => {
        input += chunk;
    });

    process.stdin.on('end', async () => {
        const jsPackages = Object.values(JSON.parse(input)).flat() || [];
        const depLicenses = {};

        for (const entry of jsPackages) {
            const { name, homepage } = entry;

            if (!depLicenses[name]) {
                depLicenses[name] = {
                    license: entry.license,
                    homepage,
                };
            }
        }

        const missingDeps = directDeps.filter((dep) => {
            let found = false;
            let match;

            for (const line of licenseFile.split('\n')) {
                match = LICENSE_REGEX.exec(line);
                LICENSE_REGEX.lastIndex = 0;

                if (match && match[1] === dep) {
                    found = true;
                    break;
                }
            }

            LICENSE_REGEX.lastIndex = 0;

            return !found;
        });

        if (missingDeps.length) {
            console.error(JSON.stringify(missingDeps, null, 2));
            console.error(`\n${missingDeps.length} missing licenses found.\n`);

            const args = process.argv.slice(2);
            const fixFlag = args.some((arg) => arg === '--fix=true');

            if (fixFlag) {
                await findMissingJsDepLicenses(missingDeps, depLicenses);
            }

            process.exit(1);
        }

        console.info('No missing licenses found.\n');
        process.exit(0);
    });
};

const checkMissingDepLicensesPython = () => {
    const pyprojectPath = 'pyproject.toml';
    const licenseFile = fs.readFileSync('LICENSE', 'utf8');

    if (fs.existsSync(pyprojectPath)) {
        const pyprojectContent = readFileSync(pyprojectPath, 'utf8');
        const depRegex = /^\s*(?:dependencies|dev)\s*=\s*\[(.*?)\]/gms;
        const deps = [];
        let match = depRegex.exec(pyprojectContent);

        while (match !== null) {
            const depsList = match[1]
                .split(',')
                .map((dep) =>
                    dep
                        .replace(/["'\s]/g, '')
                        .split('=')[0]
                        .replace(/([><=~!]=?.*)$/, '')
                        .trim(),
                )
                .filter(Boolean);

            deps.push(...depsList);
            match = depRegex.exec(pyprojectContent);
        }

        const missingDeps = deps.filter((dep) => {
            let found = false;
            let pyMatch;

            for (const line of licenseFile.split('\n')) {
                pyMatch = LICENSE_REGEX.exec(line);
                LICENSE_REGEX.lastIndex = 0;

                if (pyMatch && pyMatch[1] === dep) {
                    found = true;
                    break;
                }
            }

            LICENSE_REGEX.lastIndex = 0;

            return !found;
        });

        if (missingDeps.length) {
            console.error(JSON.stringify(missingDeps, null, 2));
            console.error(`\n${missingDeps.length} missing licenses found in LICENSE file.\n`);
            process.exit(1);
        } else {
            console.info('No missing licenses found for Python dependencies.\n');
            process.exit(0);
        }
    }
};

checkMissingDepLicenses();
checkMissingDepLicensesPython();

export default checkMissingDepLicenses;
