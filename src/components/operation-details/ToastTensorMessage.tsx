// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import 'styles/components/ToastTensorMessage.scss';
import { toHex } from '../../functions/math';

interface ToastTensorMessageProps {
    tensorId?: number;
    address?: number;
    colour?: string;
}

const ToastTensorMessage = ({ tensorId, address, colour }: ToastTensorMessageProps) => (
    <div className='toast-tensor-message'>
        <div
            className='memory-color-block'
            style={colour ? { backgroundColor: colour } : {}}
        />

        <strong>
            {tensorId ? `Tensor ${tensorId}` : 'Buffer'}
            <span className='light'>{' at '}</span>
            {address ? toHex(address) : 'NULL'}
            <span className='light'>{' selected'}</span>
        </strong>
    </div>
);

export default ToastTensorMessage;
