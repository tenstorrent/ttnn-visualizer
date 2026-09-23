// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai';
import 'styles/components/ToastTensorMessage.scss';
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

/**
 * Deselects rather than only closing the toast.
 *
 * Clicking the toast body already cleared the selection, but nothing said so — the toast
 * read as a notice, so the way out of a focused buffer was to guess at it or click an
 * empty part of the page. Dismissing the toast without dropping the selection would be
 * worse than either: the highlight would stay with nothing left to explain it. #2042
 */
export const ToastDeselectButton = ({ onDeselect }: { onDeselect: () => void }) => (
    <button
        type='button'
        className='toast-deselect'
        aria-label='Deselect buffer'
        onClick={(event) => {
            // The toast body carries the same handler, and react-toastify would run it
            // after this one. Harmless, but it makes the button look conditional in a way
            // it is not.
            event.stopPropagation();
            onDeselect();
        }}
    >
        <Icon
            icon={IconNames.CROSS}
            size={12}
        />
    </button>
);

export default ToastTensorMessage;
