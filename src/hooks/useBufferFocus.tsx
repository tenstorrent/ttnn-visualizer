// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Id, toast } from 'react-toastify';
import { useAtom } from 'jotai';
import { getBufferColor, getTensorColor } from '../functions/colorGenerator';
import ToastTensorMessage from '../components/operation-details/ToastTensorMessage';
import { activeToastAtom, selectedAddressAtom, selectedBufferColourAtom, selectedTensorIdAtom } from '../store/app';

const useBufferFocus = () => {
    const [activeToast, setActiveToast] = useAtom(activeToastAtom);
    const [selectedTensorId, setSelectedTensorId] = useAtom(selectedTensorIdAtom);
    const [selectedAddress, setSelectedAddress] = useAtom(selectedAddressAtom);
    const [selectedBufferColour, setSelectedBufferColour] = useAtom(selectedBufferColourAtom);

    const resetToasts = () => {
        setSelectedTensorId(null);
        setSelectedAddress(null);
        setSelectedBufferColour(null);
        setActiveToast(null);
        toast.dismiss();
    };

    const createToast = (address?: number, tensorId?: number, colorVariance?: number) => {
        if (activeToast) {
            toast.dismiss(activeToast);
        }

        let colour = getTensorColor(tensorId);

        if (address && !colour) {
            colour = getBufferColor(address + (colorVariance || 0));
        }

        setSelectedBufferColour(colour ?? null);

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

    const updateBufferFocus = (address?: number, tensorId?: number, colorVariance?: number): void => {
        setSelectedAddress(address ?? null);
        setSelectedTensorId(tensorId ?? null);
        createToast(address, tensorId, colorVariance);
    };

    return {
        selectedTensorId,
        selectedAddress,
        activeToast,
        resetToasts,
        setActiveToast,
        updateBufferFocus,
        selectedBufferColour,
    };
};

export default useBufferFocus;
