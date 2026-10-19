// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Id } from 'react-toastify';
import { useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { createToast, dismissToast } from '../functions/createToastNotification';
import { getBufferColor, getTensorColor } from '../functions/colorGenerator';
import isValidNumber from '../functions/isValidNumber';
import ToastTensorMessage, { ToastDeselectButton } from '../components/operation-details/ToastTensorMessage';
import { activeToastAtom, selectedAddressAtom, selectedBufferColourAtom, selectedTensorIdAtom } from '../store/app';

/** Clears the buffer focus and its toast, through setters alone, so a caller needn't subscribe to it. */
export const useResetBufferFocus = () => {
    const setActiveToast = useSetAtom(activeToastAtom);
    const setSelectedTensorId = useSetAtom(selectedTensorIdAtom);
    const setSelectedAddress = useSetAtom(selectedAddressAtom);
    const setSelectedBufferColour = useSetAtom(selectedBufferColourAtom);

    return useCallback(() => {
        setSelectedTensorId(null);
        setSelectedAddress(null);
        setSelectedBufferColour(null);
        setActiveToast(null);
        // No id, so this closes every open toast rather than only the focused buffer's. #2149
        dismissToast();
    }, [setActiveToast, setSelectedAddress, setSelectedBufferColour, setSelectedTensorId]);
};

const useBufferFocus = () => {
    const [activeToast, setActiveToast] = useAtom(activeToastAtom);
    const [selectedTensorId, setSelectedTensorId] = useAtom(selectedTensorIdAtom);
    const [selectedAddress, setSelectedAddress] = useAtom(selectedAddressAtom);
    const [selectedBufferColour, setSelectedBufferColour] = useAtom(selectedBufferColourAtom);
    const resetBufferFocus = useResetBufferFocus();

    const updateBufferFocus = useCallback(
        (address?: number, tensorId?: number, colorVariance?: number): void => {
            const previousToast = activeToast;
            let colour = getTensorColor(tensorId);

            if (previousToast) {
                dismissToast(previousToast);
            }

            if (isValidNumber(address) && !colour) {
                colour = getBufferColor(address + (colorVariance || 0));
            }

            setSelectedBufferColour(colour ?? null);

            const toastInstance: Id = createToast(
                <ToastTensorMessage
                    tensorId={tensorId}
                    address={address}
                    colour={colour}
                />,
                {
                    autoClose: false,
                    hideProgressBar: true,
                    onClick: resetBufferFocus,
                    // Per toast rather than on the container in `Layout.tsx`: this is the
                    // only toast that owns state outside itself, so it is the only one
                    // whose dismissal has to mean something. The rest close themselves.
                    closeButton: <ToastDeselectButton onDeselect={resetBufferFocus} />,
                },
            );

            setActiveToast(toastInstance);
            setSelectedAddress(address ?? null);
            setSelectedTensorId(tensorId ?? null);
        },
        [
            activeToast,
            resetBufferFocus,
            setActiveToast,
            setSelectedAddress,
            setSelectedBufferColour,
            setSelectedTensorId,
        ],
    );

    return {
        selectedTensorId,
        selectedAddress,
        activeToast,
        resetBufferFocus,
        setActiveToast,
        updateBufferFocus,
        selectedBufferColour,
    };
};

export default useBufferFocus;
