// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import 'styles/components/ToastTensorMessage.scss';
import { useAtomValue } from 'jotai';
import { prettyPrintAddress } from '../../functions/math';
import { showHexAtom } from '../../store/app';

interface ToastTensorMessageProps {
    tensorId?: number;
    address?: number;
    colour?: string;
}

const ToastTensorMessage = ({ tensorId, address, colour }: ToastTensorMessageProps) => {
    const showHex = useAtomValue(showHexAtom);
    const formattedAddress = prettyPrintAddress(address ?? null, 0, showHex);

    return (
        <div className='toast-tensor-message'>
            <div
                className='memory-color-block'
                style={colour ? { backgroundColor: colour } : {}}
            />

            <strong>
                {tensorId ? `Tensor ${tensorId}` : 'Buffer'}
                <span className='light'>{' at '}</span>
                {formattedAddress}
                <span className='light'>{' selected'}</span>
            </strong>
        </div>
    );
};

export default ToastTensorMessage;
