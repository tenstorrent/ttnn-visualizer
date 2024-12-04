// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import TensorDetailsComponent from './TensorDetailsComponent';
import { OperationDetails } from '../../model/OperationDetails';
import 'styles/components/TensorDetailsList.scss';

interface TensorDetailsProps {
    operationDetails: OperationDetails;
    plotZoomRangeStart: number;
    plotZoomRangeEnd: number;
    onTensorClick: (address?: number, tensorId?: number) => void;
}

function TensorDetailsList({
    operationDetails,
    plotZoomRangeStart,
    plotZoomRangeEnd,
    onTensorClick,
}: TensorDetailsProps) {
    const { id, inputs, outputs, memorySizeL1 } = operationDetails;

    return (
        <div className='tensor-list'>
            <div className='column'>
                <h3 className='title'>Inputs</h3>

                {inputs.map((tensor, index) => (
                    <TensorDetailsComponent
                        tensor={tensor}
                        key={`${tensor.id}-${index}`}
                        onTensorClick={onTensorClick}
                        memorySize={memorySizeL1}
                        operationId={id}
                        zoomRange={[plotZoomRangeStart, plotZoomRangeEnd]}
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
                        memorySize={memorySizeL1}
                        operationId={id}
                        zoomRange={[plotZoomRangeStart, plotZoomRangeEnd]}
                    />
                ))}
            </div>
        </div>
    );
}

export default TensorDetailsList;
