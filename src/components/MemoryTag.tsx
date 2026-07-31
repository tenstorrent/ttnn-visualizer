// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Tag } from '@blueprintjs/core';
import { stripEnum } from '../functions/formatting';

interface MemoryTagProps {
    memory: string | undefined;
}

const MemoryTag = ({ memory }: MemoryTagProps) => {
    if (memory === undefined) {
        return null;
    }

    const memoryLabel = stripEnum(memory);
    const memoryType = memoryLabel?.toLowerCase();
    const memoryClass = `memory-tag tag-${memoryType.replace(/ /g, '-')}`;

    return <Tag className={memoryClass}>{memoryLabel}</Tag>;
};

export default MemoryTag;
