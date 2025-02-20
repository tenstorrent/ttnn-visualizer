import { BufferData, FragmentationEntry } from '../model/APIData';
import { BufferType } from '../model/BufferType';

const getGroupedMemoryReport = (data: BufferData[], bufferType: BufferType) => {
    const groupedMap = new Map<number, FragmentationEntry[]>();

    data.filter((buffer) => buffer.buffer_type === bufferType).forEach((buffer, index) => {
        const previousBuffer = data[index - 1];
        const entry: FragmentationEntry = {
            ...buffer,
            size: buffer.max_size_per_bank,
            empty: index - 1 >= 0 && previousBuffer.address + previousBuffer.max_size_per_bank < buffer.address,
        };

        if (groupedMap.has(entry.address)) {
            groupedMap.get(entry.address)?.push(entry);
        } else {
            groupedMap.set(entry.address, [entry]);
        }
    });

    return groupedMap;
};

export default getGroupedMemoryReport;
