// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import 'styles/components/OperationArguments.scss';
import { ScrollToOptions } from '@tanstack/react-virtual';
import { useRef } from 'react';
import ExpandableTensor from './ExpandableTensor';

import { OperationDescription } from "../model/APIData";

interface OperationArgumentsProps {
    operation: OperationDescription;
    operationIndex?: number;
    onCollapseTensor?: (index: number, { align, behavior }: ScrollToOptions) => void;
}

function OperationArguments({ operationIndex, operation, onCollapseTensor }: OperationArgumentsProps) {
    const { id, arguments: operationArguments } = operation;
    const cellRef = useRef<null | HTMLTableCellElement>(null);

    const handleOnCollapse = () => {
        if (cellRef.current && operationIndex && onCollapseTensor && !isElementCompletelyInViewPort(cellRef.current)) {
            // Looks better if we scroll to the previous index
            onCollapseTensor(operationIndex - 1, {
                align: 'start',
            });
        }
    };

    return (
        <table className='arguments-table has-vertical-headings'>
            <caption>Arguments</caption>

            <tbody>
                {operationArguments?.map((arg) => (
                    <tr key={`${id}-${arg.name}`}>
                        <td>{arg.name}</td>

                        <td ref={cellRef}>
                            <ExpandableTensor
                                tensor={arg.value}
                                onCollapse={handleOnCollapse}
                            />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function isElementCompletelyInViewPort(element: HTMLTableCellElement) {
    const elementData = element.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;

    return elementData.bottom <= height && elementData.right <= width && elementData.left >= 0 && elementData.top >= 0;
}

export default OperationArguments;
