// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Tag } from '@blueprintjs/core';

interface MemoryTagProps {
    /** A display label from `BufferTypeLabel` / `StringBufferTypeLabel`, not a raw enum key. */
    memory: string | undefined;
}

const MemoryTag = ({ memory }: MemoryTagProps) => {
    if (memory === undefined) {
        return null;
    }

    const memoryClass = `memory-tag tag-${memory.toLowerCase().replaceAll(' ', '-')}`;

    return <Tag className={memoryClass}>{memory}</Tag>;
};

export default MemoryTag;
