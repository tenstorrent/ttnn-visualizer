// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { toast } from 'react-toastify';
import { useAtom, useSetAtom } from 'jotai';
import { getBufferColor, getTensorColor } from '../functions/colorGenerator';
import ToastTensorMessage from '../components/operation-details/ToastTensorMessage';
import { activeToastAtom, selectedAddressAtom, selectedTensorAtom } from '../store/app';
import { Buffer, Tensor } from '../model/APIData';

const useBufferFocus = () => {
    const [activeToast, setActiveToast] = useAtom(activeToastAtom);
    const [selectedTensor, setSelectedTensor] = useAtom(selectedTensorAtom);
    const setSelectedAddress = useSetAtom(selectedAddressAtom);

    const clearBufferFocus = () => {
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
                onClick: clearBufferFocus,
                theme: 'light',
            },
        ) as number;

        setActiveToast(toastInstance);
    };

    const updateFocusedBuffer = (buffer?: Buffer, tensor?: Tensor) => {
        if (!buffer) {
            clearBufferFocus();
            return;
        }

        setSelectedTensor(tensor?.id === selectedTensor ? null : (tensor?.id ?? null));
        setSelectedAddress(tensor?.address === selectedTensor ? null : (tensor?.address ?? buffer.address));
        createToast(tensor?.address ?? buffer.address, tensor?.id);
    };

    return { activeToast, clearBufferFocus, setActiveToast, createToast, updateFocusedBuffer };
};

export default useBufferFocus;
