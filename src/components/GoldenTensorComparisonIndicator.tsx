import calculateOpPerformanceColor from '../functions/calculateOpPerformanceColor';
import 'styles/components/GoldenTensorComparisonIndicator.scss';

interface GoldenTensorComparisonIndicatorProps {
    value: number;
}

function GoldenTensorComparisonIndicator({ value }: GoldenTensorComparisonIndicatorProps) {
    return (
        <>
            <div
                className='golden-tensor-comparison-square'
                style={{
                    backgroundColor: calculateOpPerformanceColor(value),
                }}
            />
            <span>t{value.toFixed(4)}</span>
        </>
    );
}

export default GoldenTensorComparisonIndicator;
