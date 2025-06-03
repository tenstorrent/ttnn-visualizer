/* eslint-disable no-console */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import fs from 'fs';
import path from 'path';

// License formats
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
const NON_COMPLIANT_FILES = [];

const isFileType = (filePath, extensions) => extensions.includes(path.extname(filePath).toLowerCase());

const checkLicenseString = (filePath, licenseType) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const firstFewLines = content.split('\n').slice(0, 3).join('\n');

    if (!firstFewLines.includes(licenseType)) {
        NON_COMPLIANT_FILES.push(filePath);
    }
};

const checkLicenseObject = (filePath, licenseType) => {
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
            NON_COMPLIANT_FILES.push(filePath);
        }
    } catch (err) {
        console.error(`Error processing file ${filePath}:`, err);
        NON_COMPLIANT_FILES.push(filePath);
    }
};

function walkDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(process.cwd(), fullPath);

        if (
            entry.isDirectory() &&
            !IGNORED_DIRS.some((ignoredDirectory) => relativePath.startsWith(ignoredDirectory))
        ) {
            walkDirectory(fullPath);
        } else if (entry.isFile()) {
            if (isFileType(relativePath, JS_FILE_EXTENSIONS)) {
                checkLicenseString(relativePath, SPDX_JS_LICENSE);
            } else if (isFileType(relativePath, PYTHON_FILE_EXTENSIONS)) {
                checkLicenseString(relativePath, SPDX_PYTHON_LICENSE);
            } else if (isFileType(relativePath, JSON_FILE_EXTENSIONS) && relativePath.includes('package.json')) {
                checkLicenseObject(relativePath, SPDX_PACKAGE_JSON_LICENSE);
            }
        }
    }
}

walkDirectory(process.cwd());

if (NON_COMPLIANT_FILES.length > 0) {
    console.error(`${NON_COMPLIANT_FILES.length} files missing the SPDX-License-Identifier string:`);
    NON_COMPLIANT_FILES.forEach((file) => console.log(file));
    process.exit(1);
} else {
    console.log('All scanned files contain the SPDX-License-Identifier string.');
    process.exit(0);
}
