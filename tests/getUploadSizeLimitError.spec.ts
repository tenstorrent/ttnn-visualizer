// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { beforeEach, expect, test, vi } from 'vitest';
import getUploadSizeLimitError from '../src/functions/getUploadSizeLimitError';

const serverConfig = vi.hoisted(() => ({ MAX_CONTENT_LENGTH: null as number | null }));

vi.mock('../src/functions/getServerConfig', () => ({ default: () => serverConfig }));

function createFiles(...sizes: number[]): FileList {
    return sizes.map((size, index) => new File([new Uint8Array(size)], `file-${index}`)) as unknown as FileList;
}

beforeEach(() => {
    serverConfig.MAX_CONTENT_LENGTH = null;
});

test('does not reject uploads when the server has no request limit', () => {
    expect(getUploadSizeLimitError(createFiles(10))).toBeNull();
});

test('does not reject uploads when the files and multipart envelope fit', () => {
    serverConfig.MAX_CONTENT_LENGTH = 4096;

    expect(getUploadSizeLimitError(createFiles(10))).toBeNull();
});

test('reports the aggregate upload size limit before sending a request', () => {
    serverConfig.MAX_CONTENT_LENGTH = 4096;

    expect(getUploadSizeLimitError(createFiles(1024, 1025))).toBe('Selected upload exceeds the 4 KiB request limit.');
});

test('reserves room for the multipart envelope', () => {
    serverConfig.MAX_CONTENT_LENGTH = 2048;

    expect(getUploadSizeLimitError(createFiles(1024))).toBe('Selected upload exceeds the 2 KiB request limit.');
});
