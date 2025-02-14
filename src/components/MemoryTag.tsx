import { Tag } from '@blueprintjs/core';

interface MemoryTagProps {
    memory: string | undefined;
}

const MemoryTag = ({ memory }: MemoryTagProps) => {
    const memoryType = memory?.toLowerCase() || '';
    return <Tag className={`tag-${memoryType}`}>{memory}</Tag>;
};
export default MemoryTag;
