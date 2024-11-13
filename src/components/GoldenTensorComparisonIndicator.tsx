import calculateOpPerformanceColor from '../functions/calculateOpPerformanceColor';
import 'styles/components/GoldenTensorComparisonIndicator.scss';

interface GoldenTensorComparisonIndicatorProps {
    value: number;
    label: string;
}

function GoldenTensorComparisonIndicator({ value, label }: GoldenTensorComparisonIndicatorProps) {
    return (
        <div className='golden-tensor-comparison'>
            <span>
                <strong>{label}</strong> {value.toFixed(4)}
            </span>

            <div
                className='memory-color-block'
                style={{
                    backgroundColor: calculateOpPerformanceColor(value),
                }}
            />
        </div>
    );
}

export default GoldenTensorComparisonIndicator;
