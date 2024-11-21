import { useEffect } from 'react';
import useToasts from '../hooks/useToasts';

function useClearSelectedBuffer() {
    const { resetToasts } = useToasts();

    useEffect(() => {
        resetToasts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}

export default useClearSelectedBuffer;
