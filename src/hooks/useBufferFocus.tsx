// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Id, toast } from 'react-toastify';
import { useAtom } from 'jotai';
import { getBufferColor, getTensorColor } from '../functions/colorGenerator';
import ToastTensorMessage from '../components/operation-details/ToastTensorMessage';
import { activeToastAtom, selectedAddressAtom, selectedTensorIdAtom } from '../store/app';

const useBufferFocus = () => {
    const [activeToast, setActiveToast] = useAtom(activeToastAtom);
    const [selectedTensorId, setSelectedTensorId] = useAtom(selectedTensorIdAtom);
    const [selectedAddress, setSelectedAddress] = useAtom(selectedAddressAtom);

    const resetToasts = () => {
        setSelectedTensorId(null);
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

        const toastInstance: Id = toast(
            <ToastTensorMessage
                tensorId={tensorId}
                address={address}
                colour={colour}
            />,
            {
                autoClose: false,
                hideProgressBar: true,
                onClick: resetToasts,
            },
        );

        setActiveToast(toastInstance);
    };

    const updateBufferFocus = (address?: number, tensorId?: number): void => {
        setSelectedAddress(address ?? null);
        setSelectedTensorId(tensorId ?? null);
        createToast(address, tensorId);
    };

    return { selectedTensorId, selectedAddress, activeToast, resetToasts, setActiveToast, updateBufferFocus };
};

export default useBufferFocus;
