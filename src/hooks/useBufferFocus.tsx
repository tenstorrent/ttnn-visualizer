// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Id, toast } from 'react-toastify';
import { useCallback } from 'react';
import { useAtom } from 'jotai';
import { getBufferColor, getTensorColor } from '../functions/colorGenerator';
import isValidNumber from '../functions/isValidNumber';
import ToastTensorMessage from '../components/operation-details/ToastTensorMessage';
import { activeToastAtom, selectedAddressAtom, selectedBufferColourAtom, selectedTensorIdAtom } from '../store/app';

const useBufferFocus = () => {
    const [activeToast, setActiveToast] = useAtom(activeToastAtom);
    const [selectedTensorId, setSelectedTensorId] = useAtom(selectedTensorIdAtom);
    const [selectedAddress, setSelectedAddress] = useAtom(selectedAddressAtom);
    const [selectedBufferColour, setSelectedBufferColour] = useAtom(selectedBufferColourAtom);

    const resetToasts = useCallback(() => {
        setSelectedTensorId(null);
        setSelectedAddress(null);
        setSelectedBufferColour(null);
        setActiveToast(null);
        toast.dismiss();
    }, [setActiveToast, setSelectedAddress, setSelectedBufferColour, setSelectedTensorId]);

    const updateBufferFocus = useCallback(
        (address?: number, tensorId?: number, colorVariance?: number): void => {
            const previousToast = activeToast;
            let colour = getTensorColor(tensorId);

            if (previousToast) {
                toast.dismiss(previousToast);
            }

            if (isValidNumber(address) && !colour) {
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
            setSelectedAddress(address ?? null);
            setSelectedTensorId(tensorId ?? null);
        },
        [activeToast, resetToasts, setActiveToast, setSelectedAddress, setSelectedBufferColour, setSelectedTensorId],
    );

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
