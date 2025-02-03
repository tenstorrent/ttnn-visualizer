import { Button, InputGroup, NumberRange, RangeSlider } from '@blueprintjs/core';
import { useAtom, useAtomValue } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { useLocation } from 'react-router';
import { useEffect } from 'react';
import { operationRangeAtom, selectedRangeAtom } from '../store/app';
import ROUTES from '../definitions/Routes';
import 'styles/components/RangeSlider.scss';

const RANGE_STEP = 25;

function Range() {
    const operationRange = useAtomValue(operationRangeAtom);
    // const performanceRange = useAtomValue(performanceRangeAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedRangeAtom);
    const location = useLocation();

    const range = getValidRange(operationRange);
    const min = range?.[0];
    const max = range?.[1];
    const stepSize = max ? getStepSize(max) : 0;

    useEffect(() => {
        if (!selectedRange && min && max) {
            setSelectedRange([min, max]);
        }
    }, [min, max, selectedRange, setSelectedRange]);

    return selectedRange && min && max ? (
        <div className='range-slider'>
            <RangeSlider
                className='slider'
                value={selectedRange}
                onChange={(value) => setSelectedRange(value)}
                min={min}
                max={max}
                labelStepSize={stepSize}
                disabled={location.pathname.includes(`${ROUTES.OPERATIONS}/`)}
            />

            <div className='inputs'>
                <InputGroup
                    value={selectedRange[0].toString()}
                    onValueChange={(value) => setSelectedRange([parseInt(value, 10), selectedRange[1]])}
                    fill={false}
                    small
                />

                <InputGroup
                    value={selectedRange[1].toString()}
                    onValueChange={(value) => setSelectedRange([selectedRange[0], parseInt(value, 10)])}
                    fill={false}
                    small
                />

                <Button
                    icon={IconNames.RESET}
                    onClick={() => setSelectedRange([min, max])}
                    minimal
                    outlined
                    small
                />
            </div>
        </div>
    ) : null;
}

const getStepSize = (max: number) => (RANGE_STEP > max ? 1 : max / RANGE_STEP);

const getValidRange = (operationRange: NumberRange) => {
    return operationRange?.[0] !== 0 && operationRange?.[1] !== 0 ? operationRange : [0, 0];
};

export default Range;
