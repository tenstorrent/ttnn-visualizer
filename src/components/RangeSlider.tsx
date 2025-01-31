import { RangeSlider } from '@blueprintjs/core';
import { useAtom, useAtomValue } from 'jotai';
import { useLocation } from 'react-router';
import { useEffect } from 'react';
import { operationRangeAtom, selectedRangeAtom } from '../store/app';
import ROUTES from '../definitions/Routes';

const RANGE_STEP = 25;

function Range() {
    const operationRange = useAtomValue(operationRangeAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedRangeAtom);
    const location = useLocation();

    const min = operationRange?.[0] ?? 0;
    const max = operationRange?.[1] ?? 0;
    const stepSize = RANGE_STEP > max ? 1 : max / RANGE_STEP;

    useEffect(() => {
        if (!selectedRange) {
            setSelectedRange([min, max]);
        }
    }, [min, max, selectedRange, setSelectedRange]);

    return selectedRange ? (
        <RangeSlider
            value={selectedRange}
            onChange={(range) => setSelectedRange(range)}
            min={min}
            max={max}
            labelStepSize={stepSize}
            disabled={location.pathname.includes(`${ROUTES.OPERATIONS}/`)}
        />
    ) : null;
}

export default Range;
