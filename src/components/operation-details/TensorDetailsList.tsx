import TensorDetailsComponent from './TensorDetailsComponent';
import { OperationDetails } from '../../model/OperationDetails';
import 'styles/components/TensorDetailsList.scss';

interface TensorDetailsProps {
    operationDetails: OperationDetails;
    plotZoomRangeStart: number;
    plotZoomRangeEnd: number;
    onTensorClick: (address?: number, tensorId?: number) => void;
    selectedTensorId: number | null;
}

function TensorDetailsList({
    operationDetails,
    plotZoomRangeStart,
    plotZoomRangeEnd,
    onTensorClick,
    selectedTensorId,
}: TensorDetailsProps) {
    const { id, inputs, outputs, memorySizeL1 } = operationDetails;

    return (
        <div className='tensor-list'>
            <div className='column'>
                <h3 className='title'>Inputs</h3>

                {inputs.map((tensor, index) => (
                    <TensorDetailsComponent
                        tensor={tensor}
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        selectedTensorId={selectedTensorId}
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
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        selectedTensorId={selectedTensorId}
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
