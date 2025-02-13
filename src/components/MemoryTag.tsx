import { Tag } from '@blueprintjs/core';

interface MemoryTagProps {
    memory: string | undefined;
}

const MemoryTag = ({ memory }: MemoryTagProps) => {
    if (memory?.toLowerCase() === 'l1') {
        return <Tag className='tag-l1'>L1</Tag>;
    }
    if (memory?.toLowerCase() === 'dram') {
        return <Tag className='tag-dram'>DRAM</Tag>;
    }
    return <Tag>{memory}</Tag>;
};
export default MemoryTag;
