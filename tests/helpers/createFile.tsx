// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const MOCK_FOLDER = 'mock_folder';

function createFile(fileName: string, type: string): File {
    const file = new File([''], fileName, { type });

    Object.defineProperty(file, 'webkitRelativePath', {
        value: `${MOCK_FOLDER}/${fileName}`,
        writable: false,
    });

    return file;
}

export default createFile;
