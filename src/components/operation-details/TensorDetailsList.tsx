import { useAtomValue } from 'jotai';
import TensorDetailsComponent from './TensorDetailsComponent';
import { selectedAddressAtom } from '../../store/app';
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
    const selectedAddress = useAtomValue(selectedAddressAtom);
    const { id, inputs, outputs, memorySizeL1 } = operationDetails;

    return (
        <div className='tensor-list'>
            <div>
                <h3>Inputs</h3>

                {inputs.map((tensor) => (
                    <TensorDetailsComponent
                        tensor={tensor}
                        key={tensor.id}
                        selectedAddress={selectedAddress}
                        onTensorClick={onTensorClick}
                        memorySize={memorySizeL1}
                        operationId={id}
                        zoomRange={[plotZoomRangeStart, plotZoomRangeEnd]}
                    />
                ))}
            </div>

            <div>
                <h3>Outputs</h3>

                {outputs.map((tensor) => (
                    <TensorDetailsComponent
                        tensor={tensor}
                        key={tensor.id}
                        selectedAddress={selectedAddress}
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
