import { useQuery } from 'react-query';
import axios from 'axios';

interface NextBufferProps {
    address: number;
    consumers: number[];
    queryKey: string | number;
}

interface BufferData {
    operation_id: number;
    device_id: number;
    address: number;
    max_size_per_bank: number;
    buffer_type: number;
}

const fetchNextUseOfBuffer = async (address: number, consumers: number[]): Promise<BufferData> => {
    const { data: buffer } = await axios.get(
        `/api/buffer?address=${address}&operation_id=${consumers[consumers.length - 1]}`,
    );

    return buffer;
};

function NextBuffer({ address, consumers, queryKey }: NextBufferProps) {
    const { data: buffer, isLoading } = useQuery(queryKey.toString(), {
        queryFn: () => fetchNextUseOfBuffer(address, consumers),
    });

    if (isLoading) {
        return 'Finding next buffer...';
    }

    return buffer ? `${address} next allocated in Operation ${buffer.operation_id}` : 'No subsequent buffer found';
}

export default NextBuffer;
