#!/usr/bin/env node
/* eslint-disable no-console */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import fs from 'fs';
import { execSync } from 'child_process';

const bumpType = process.argv[2];

const color = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',

    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',

    gray: '\x1b[90m',
};

if (!['-patch', '-minor', '-major'].includes(bumpType)) {
    console.error('❌Usage: node version-bump.mjs [-patch|-minor|-major]');
    process.exit(1);
}

function bumpVersion(version, type) {
    const [major, minor, patch] = version.split('.').map(Number);
    if (type === '-major') {
        return `${major + 1}.0.0`;
    }
    if (type === '-minor') {
        return `${major}.${minor + 1}.0`;
    }
    return `${major}.${minor}.${patch + 1}`;
}

// eslint-disable-next-line consistent-return
function getCurrentBranch() {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
        console.error('❌Error: unable to determine git branch. Are you in a git repo?');
        process.exit(1);
    }
}

const isNotPatch = bumpType === '-minor' || bumpType === '-major';

if (isNotPatch) {
    const branch = getCurrentBranch();
    if (branch !== 'dev') {
        console.error(
            `🚫 ${color.red}Release (-minor/-major) must be run on "dev" branch.${color.reset}\n` +
                `${color.blue}Current branch: ${branch} Aborting without changes.${color.reset}`,
        );
        process.exit(1);
    }
}

execSync('git pull', { stdio: 'inherit' });

const pkgPath = './package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const oldVersion = pkg.version;
const newVersion = bumpVersion(oldVersion, bumpType);
pkg.version = newVersion;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Updated package.json to version ${newVersion}`);

const pyPath = './pyproject.toml';
let pyContents = fs.readFileSync(pyPath, 'utf8');
pyContents = pyContents.replace(/version\s*=\s*["']\d+\.\d+\.\d+["']/, `version = "${newVersion}"`);
fs.writeFileSync(pyPath, pyContents);
console.log(`Updated pyproject.toml to version ${newVersion}`);

execSync(`git add package.json pyproject.toml`, { stdio: 'inherit' });
execSync(`git commit -m "v${newVersion}"`, { stdio: 'inherit' });
execSync(`git tag v${newVersion}`, { stdio: 'inherit' });
execSync(`git push`, { stdio: 'inherit' });
execSync(`git push --tags`, { stdio: 'inherit' });
console.log(`${color.green}${color.bold}Committed, tagged, and pushed as v${newVersion}${color.reset}`);
