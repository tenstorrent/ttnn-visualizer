// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Tag } from '@blueprintjs/core';
import { stripEnum } from '../functions/formatting';

interface MemoryTagProps {
    memory: string | undefined;
}

const MemoryTag = ({ memory }: MemoryTagProps) => {
    const memoryLabel = stripEnum(memory || '').replace(' ', '-');
    const memoryType = memoryLabel?.toLowerCase() || '';

    return <Tag className={`tag-${memoryType}`}>{memoryLabel}</Tag>;
};
export default MemoryTag;
