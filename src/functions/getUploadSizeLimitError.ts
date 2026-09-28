// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import getServerConfig from './getServerConfig';
import { formatMemorySize } from './math';

const MULTIPART_BASE_OVERHEAD_BYTES = 1024;
const MULTIPART_OVERHEAD_BYTES_PER_FILE = 1024;

export default function getUploadSizeLimitError(files: FileList): string | null {
    const maxContentLength = getServerConfig().MAX_CONTENT_LENGTH;
    if (typeof maxContentLength !== 'number' || !Number.isSafeInteger(maxContentLength) || maxContentLength <= 0) {
        return null;
    }

    // Flask limits the encoded request, not just its files. Leave enough room for each
    // part's headers and boundary so a near-limit selection does not become an opaque
    // connection reset before Flask can return its structured 413 response.
    const uploadBytes = Array.from(files).reduce(
        (totalBytes, file) => totalBytes + file.size + MULTIPART_OVERHEAD_BYTES_PER_FILE,
        MULTIPART_BASE_OVERHEAD_BYTES,
    );
    if (uploadBytes <= maxContentLength) {
        return null;
    }

    return `Selected upload exceeds the ${formatMemorySize(maxContentLength)} request limit.`;
}
