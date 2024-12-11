// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { toast } from 'react-toastify';
import { useAtom, useSetAtom } from 'jotai';
import { getBufferColor, getTensorColor } from '../functions/colorGenerator';
import ToastTensorMessage from '../components/operation-details/ToastTensorMessage';
import { activeToastAtom, selectedAddressAtom, selectedTensorAtom } from '../store/app';

const useBufferFocus = () => {
    const [activeToast, setActiveToast] = useAtom(activeToastAtom);
    const setSelectedTensor = useSetAtom(selectedTensorAtom);
    const setSelectedAddress = useSetAtom(selectedAddressAtom);

    const resetToasts = () => {
        setSelectedTensor(null);
        setSelectedAddress(null);
        setActiveToast(null);
        toast.dismiss();
    };

    const createToast = (address?: number, tensorId?: number) => {
        if (activeToast) {
            toast.dismiss(activeToast);
        }

        let colour = getTensorColor(tensorId);

        if (address && !colour) {
            colour = getBufferColor(address);
        }

        const toastInstance = toast(
            <ToastTensorMessage
                tensorId={tensorId}
                address={address}
                colour={colour}
            />,
            {
                position: 'bottom-right',
                hideProgressBar: true,
                closeOnClick: true,
                onClick: resetToasts,
                theme: 'light',
            },
        ) as number;

        setActiveToast(toastInstance);
    };

    return { activeToast, resetToasts, setActiveToast, createToast };
};

export default useBufferFocus;
