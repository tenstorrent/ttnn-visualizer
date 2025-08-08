/* eslint-disable no-console */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import fs from 'fs';
import getMissingLicenses from './get-missing-licenses.mjs';

const checkMissingLicenses = () => {
    // Read package.json
    const PKG = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const DIRECT_DEPS = [...Object.keys(PKG.dependencies || {}), ...Object.keys(PKG.devDependencies || {})];

    // Read LICENSE
    const LICENSE_FILE = fs.readFileSync('LICENSE', 'utf8');

    const LICENSE_REGEX = /^-\s+([^\s–]+)\s*-\s*([^-–]+?(?: or [^-–]+)?)\s*-\s*(.+\S[^-])$/gm;

    // Read stdin (pnpm licenses ls --json output)
    let input = '';

    process.stdin.on('data', (chunk) => {
        input += chunk;
    });

    process.stdin.on('end', async () => {
        // Parse output from pnpm licenses ls --json
        const packages = Object.values(JSON.parse(input)).flat() || [];
        const depLicenses = {};

        for (const entry of packages) {
            const { name, homepage } = entry;

            if (!depLicenses[name]) {
                depLicenses[name] = {
                    license: entry.license,
                    homepage,
                };
            }
        }

        const missingDeps = DIRECT_DEPS.filter((dep) => {
            // Find a line in LICENSE_FILE that includes dep and matches LICENSE_REGEX
            let found = false;
            let match;

            for (const line of LICENSE_FILE.split('\n')) {
                match = LICENSE_REGEX.exec(line);
                LICENSE_REGEX.lastIndex = 0; // Reset regex state for each line

                if (match && match[1] === dep) {
                    found = true;
                    break;
                }
            }

            LICENSE_REGEX.lastIndex = 0; // Reset regex state for next dep
            return !found;
        });

        if (missingDeps.length) {
            console.info(JSON.stringify(missingDeps, null, 2));
            console.info(`\n${missingDeps.length} missing licenses found.\n`);

            const args = process.argv.slice(2);
            const fixFlag = args.some((arg) => arg === '--fix=true');

            if (fixFlag) {
                await getMissingLicenses(missingDeps, depLicenses);
            }

            return missingDeps;
        }

        console.info('No missing licenses found.\n');
        return missingDeps;
    });
};

checkMissingLicenses();

export default checkMissingLicenses;
