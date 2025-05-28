import fs from 'fs';
import path from 'path';

const targetString = '// SPDX-License-Identifier';
const ignoredDirs = ['node_modules', '.git', '.github', '.idea', '.vscode', 'dist', 'build', 'backend', 'ttnn_env'];
const nonCompliantFiles = [];

function isTextFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return [
        '.js',
        '.ts',
        '.jsx',
        '.tsx',
        '.c',
        '.cpp',
        '.h',
        '.cs',
        '.java',
        '.py',
        '.go',
        '.rb',
        '.php',
        '.html',
        '.css',
        '.scss',
        '.json',
        '.xml',
        '.yml',
        '.yaml',
        '.txt',
    ].includes(ext);
}

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const firstFewLines = content.split('\n').slice(0, 5).join('\n');
    if (!firstFewLines.includes(targetString)) {
        nonCompliantFiles.push(filePath);
    }
}

function walkDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (!ignoredDirs.includes(entry.name)) {
                walkDirectory(fullPath);
            }
        } else if (entry.isFile() && isTextFile(fullPath)) {
            checkFile(fullPath);
        }
    }
}

const startDir = process.cwd();
walkDirectory(startDir);

if (nonCompliantFiles.length > 0) {
    // eslint-disable-next-line no-console
    console.log('Files missing the SPDX-License-Identifier string:');
    // eslint-disable-next-line no-console
    nonCompliantFiles.forEach((file) => console.log(file));
} else {
    // eslint-disable-next-line no-console
    console.log('All files contain the SPDX-License-Identifier string.');
}
