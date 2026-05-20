// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo } from 'react';
import TensorDetailsComponent from './TensorDetailsComponent';
import { OperationDetails } from '../../model/OperationDetails';
import 'styles/components/TensorDetailsList.scss';

interface TensorDetailsProps {
    operationDetails: OperationDetails;
    plotZoomRangeStart: number;
    plotZoomRangeEnd: number;
    zoomedInViewMainMemory: boolean;
    onTensorClick: (address?: number, tensorId?: number) => void;
}

function TensorDetailsList({
    operationDetails,
    plotZoomRangeStart,
    plotZoomRangeEnd,
    zoomedInViewMainMemory,
    onTensorClick,
}: TensorDetailsProps) {
    const { id, inputs, outputs } = operationDetails;
    const plotZoomRange = useMemo(
        () => [plotZoomRangeStart, plotZoomRangeEnd] as [number, number],
        [plotZoomRangeStart, plotZoomRangeEnd],
    );
    const userL1ZoomRange = useMemo(
        () => (zoomedInViewMainMemory ? plotZoomRange : undefined),
        [zoomedInViewMainMemory, plotZoomRange],
    );

    return (
        <div className='tensor-list'>
            <div className='column'>
                <h3 className='title'>Inputs</h3>

                {inputs.map((tensor, index) => (
                    <TensorDetailsComponent
                        tensor={tensor}
                        key={`${tensor.id}-${index}`}
                        onTensorClick={onTensorClick}
                        operationId={id}
                        plotZoomRange={plotZoomRange}
                        userL1ZoomRange={userL1ZoomRange}
                    />
                ))}
            </div>

            <div className='column'>
                <h3 className='title'>Outputs</h3>

                {outputs.map((tensor, index) => (
                    <TensorDetailsComponent
                        tensor={tensor}
                        key={`${tensor.id}-${index}`}
                        onTensorClick={onTensorClick}
                        operationId={id}
                        plotZoomRange={plotZoomRange}
                        userL1ZoomRange={userL1ZoomRange}
                    />
                ))}
            </div>
        </div>
    );
}

export default TensorDetailsList;
