// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import { Switch } from '@blueprintjs/core';
import { useRef, useState } from 'react';
import 'styles/components/ExpandableTensor.scss';

interface ExpandableTensorProps {
    tensor: string;
}

function ExpandableTensor({ tensor }: ExpandableTensorProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const splitTensor = tensor.split('\n');
    const cellRef = useRef<null | HTMLTableCellElement>(null);

    const handleExpandToggle = (shouldScrollTo?: boolean) => {
        setIsExpanded((previousValue) => !previousValue);

        if (shouldScrollTo && cellRef.current && !isElementCompletelyInViewPort(cellRef.current)) {
            cellRef.current.scrollIntoView();
        }
    };

    return (
        <td className='expandable-tensor' ref={cellRef}>
            <Switch
                className='expand-button'
                label={isExpanded ? 'Hide full tensor' : 'Show full tensor'}
                onChange={() => handleExpandToggle()}
                checked={isExpanded}
            />
            {isExpanded ? (
                <>
                    <pre className='full-tensor'>{tensor}</pre>
                    <Switch
                        className='expand-button'
                        label='Hide full tensor'
                        onChange={() => handleExpandToggle(true)}
                        checked={isExpanded}
                    />
                </>
            ) : (
                <>
                    <p className='collapsed-tensor'>{splitTensor[0]}</p>
                    <p className='collapsed-tensor'>.........</p>
                    <p className='collapsed-tensor'>{splitTensor[splitTensor.length - 1]}</p>
                </>
            )}
        </td>
    );
}

function isElementCompletelyInViewPort(element: HTMLTableCellElement) {
    const elementData = element.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;

    return elementData.bottom <= height && elementData.right <= width && elementData.left >= 0 && elementData.top >= 0;
}

export default ExpandableTensor;
