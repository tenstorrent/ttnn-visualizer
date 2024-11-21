import { useSetAtom } from 'jotai';
import { toast } from 'react-toastify';
import { useEffect } from 'react';
import { activeToastAtom, selectedAddressAtom, selectedTensorAtom } from '../store/app';

function useClearSelectedBuffer() {
    const setSelectedTensor = useSetAtom(selectedTensorAtom);
    const setSelectedAddress = useSetAtom(selectedAddressAtom);
    const setActiveToast = useSetAtom(activeToastAtom);

    useEffect(() => {
        setSelectedTensor(null);
        setSelectedAddress(null);
        setActiveToast(null);
        toast.dismiss();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}

export default useClearSelectedBuffer;
