#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import fs from 'fs';
import { execSync } from 'child_process';

const bumpType = process.argv[2];
if (!['-patch', '-minor', '-major'].includes(bumpType)) {
    console.error('Usage: node version-bump.mjs [-patch|-minor|-major]');
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
console.log(`Committed, tagged, and pushed as v${newVersion}`);
