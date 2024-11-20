import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useState } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'react-toastify';
import { Buffer } from '../../model/APIData';
import { formatSize, toHex } from '../../functions/math';
import { HistoricalTensor } from '../../model/Graph';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { activeToastAtom, selectedAddressAtom, selectedTensorAtom } from '../../store/app';
import { getDimmedColour } from '../../functions/colour';
import ToastTensorMessage from '../operation-details/ToastTensorMessage';

interface BufferSummaryBufferProps {
    buffer: Buffer;
    size: number;
    position: number;
    tensor?: HistoricalTensor;
}

function BufferSummaryBuffer({ buffer, size, position, tensor }: BufferSummaryBufferProps) {
    const [isHovered, setIsHovered] = useState<boolean>(false);

    const [selectedTensor, setSelectedTensor] = useAtom(selectedTensorAtom);
    const [selectedAddress, setSelectedAddress] = useAtom(selectedAddressAtom);
    const [activeToast, setActiveToast] = useAtom(activeToastAtom);

    const originalColour = tensor ? getTensorColor(tensor.id) : getBufferColor(buffer.address);
    const dimmedColour = originalColour ? getDimmedColour(originalColour) : '#000';

    const styleProps = {
        width: `${size}%`,
        left: `${position}%`,
        backgroundColor: selectedTensor && selectedTensor !== tensor?.id ? dimmedColour : originalColour,
    };

    const clearFocusedBuffer = () => {
        setSelectedTensor(null);
        setSelectedAddress(null);
        setActiveToast(null);
        toast.dismiss();
    };

    const setFocusedBuffer = () => {
        setSelectedTensor(tensor?.id === selectedTensor ? null : tensor?.id);
        setSelectedAddress(tensor?.address === selectedTensor ? null : tensor?.address ?? null);
        createToast(tensor?.address ?? undefined, tensor?.id ?? undefined);
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
                onClick: () => clearFocusedBuffer(),
                theme: 'light',
            },
        ) as number;

        setActiveToast(toastInstance);
    };

    const handleFocusBuffer = (address: number) => {
        if (address === selectedAddress) {
            clearFocusedBuffer();
        } else {
            setFocusedBuffer();
        }
    };

    return (
        <div
            className='buffer-data'
            style={styleProps}
            onMouseEnter={() => setIsHovered(true)}
        >
            {isHovered ? (
                <Tooltip
                    content={
                        <div>
                            {buffer.address} ({toHex(buffer.address)})<br />
                            Size: {formatSize(buffer.size)}
                            <br />
                            {tensor?.id ? `Tensor ${tensor.id}` : ''}
                        </div>
                    }
                    position={PopoverPosition.TOP}
                    // Need this class to override some Blueprint styling
                    className='hover-target'
                >
                    <button
                        type='button'
                        aria-label={`Select buffer ${buffer.address}`}
                        onMouseLeave={() => setIsHovered(false)}
                        className='buffer-button'
                        onClick={() => handleFocusBuffer(buffer.address)}
                    />
                </Tooltip>
            ) : null}
        </div>
    );
}

export default BufferSummaryBuffer;
