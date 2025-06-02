// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import fs from 'fs';
import path from 'path';

// Licenses
const SPDX_JS_LICENSE = '// SPDX-License-Identifier: Apache-2.0';
const SPDX_PYTHON_LICENSE = '# SPDX-License-Identifier: Apache-2.0';
const SPDX_PACKAGE_JSON_LICENSE = {
    license: 'Apache-2.0',
    author: {
        name: 'Tenstorrent AI ULC',
        url: 'https://tenstorrent.com/',
    },
};

// File extensions
const JS_FILE_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.css', '.scss', '.xml'];
const PYTHON_FILE_EXTENSIONS = ['.py'];
const JSON_FILE_EXTENSIONS = ['.json'];

const IGNORED_DIRS = [
    '.git',
    '.github',
    '.idea',
    '.vscode',
    'dist',
    'build',
    'backend/data/',
    'backend/ttnn_visualizer/data',
    'backend/ttnn_visualizer/static',
    'node_modules',
    'ttnn_env',
];
const nonCompliantFiles = [];

function isTextFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    return JS_FILE_EXTENSIONS.includes(ext);
}

function isPythonFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    return PYTHON_FILE_EXTENSIONS.includes(ext);
}

function isJSONFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    return JSON_FILE_EXTENSIONS.includes(ext);
}

function checkLicenseString(filePath, licenseType) {
    const content = fs.readFileSync(filePath, 'utf8');
    const firstFewLines = content.split('\n').slice(0, 5).join('\n');

    if (!firstFewLines.includes(licenseType)) {
        nonCompliantFiles.push(filePath);
    }
}

function checkLicenseObject(filePath, licenseType) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(content);

        const authors = json.author || {};
        const requiredAuthorShape = licenseType.author;

        const hasAllAuthorKeys = Object.keys(requiredAuthorShape).every(
            (key) => authors[key] === requiredAuthorShape[key],
        );
        const hasLicense = json.license === licenseType.license;

        if (!hasAllAuthorKeys || !hasLicense) {
            nonCompliantFiles.push(filePath);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Error processing file ${filePath}:`, err);
        nonCompliantFiles.push(filePath);
    }
}

function walkDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory() && !IGNORED_DIRS.some((ignoredDirectory) => fullPath.includes(ignoredDirectory))) {
            walkDirectory(fullPath);
        } else if (entry.isFile() && isTextFile(fullPath)) {
            checkLicenseString(fullPath, SPDX_JS_LICENSE);
        } else if (entry.isFile() && isPythonFile(fullPath)) {
            checkLicenseString(fullPath, SPDX_PYTHON_LICENSE);
        } else if (entry.isFile() && isJSONFile(fullPath) && fullPath.includes('package.json')) {
            checkLicenseObject(fullPath, SPDX_PACKAGE_JSON_LICENSE);
        }
    }
}

const startDir = process.cwd();
walkDirectory(startDir);

if (nonCompliantFiles.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`${nonCompliantFiles.length} files missing the SPDX-License-Identifier string:`);
    // eslint-disable-next-line no-console
    nonCompliantFiles.forEach((file) => console.log(file));

    process.exit(1);
} else {
    // eslint-disable-next-line no-console
    console.log('All files contain the SPDX-License-Identifier string.');

    process.exit(0);
}
