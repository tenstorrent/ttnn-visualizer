// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, InputGroup, NumberRange, RangeSlider } from '@blueprintjs/core';
import { useAtom, useAtomValue } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { useLocation } from 'react-router';
import { useEffect } from 'react';
import { operationRangeAtom, performanceRangeAtom, selectedRangeAtom } from '../store/app';
import ROUTES from '../definitions/Routes';
import 'styles/components/RangeSlider.scss';

const RANGE_STEP = 25;

function Range() {
    const operationRange = useAtomValue(operationRangeAtom);
    const performanceRange = useAtomValue(performanceRangeAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedRangeAtom);
    const location = useLocation();

    const range = getValidRange(operationRange);
    const min = range?.[0];
    const max = range?.[1];
    const stepSize = max ? getStepSize(max) : 0;

    const perfMin = performanceRange ? performanceRange[0] : null;
    const perfMax = performanceRange ? performanceRange[1] : null;

    const isOperationDetails = location.pathname.includes(`${ROUTES.OPERATIONS}/`);

    const perfAxis =
        perfMin && perfMax
            ? new Array(Math.round(perfMax / RANGE_STEP)).fill(0).map((_, index) => {
                  // eslint-disable-next-line no-nested-ternary
                  return index === 0
                      ? perfMin
                      : index === Math.round(perfMax / RANGE_STEP) - 1
                        ? perfMax
                        : (index + 1) * RANGE_STEP;
              })
            : [];

    useEffect(() => {
        if (!selectedRange && min && max) {
            setSelectedRange([min, max]);
        }
    }, [min, max, selectedRange, setSelectedRange]);

    return selectedRange && min && max ? (
        <div className='range-slider'>
            <div className='slider'>
                <div className='alt-x-axis bp5-slider-axis'>
                    {perfAxis?.map((tick, index) => (
                        <div
                            className='bp5-slider-label'
                            data-index={index}
                            style={{ left: `${(index / (perfAxis.length - 1)) * 100}%` }}
                        >
                            {tick}
                        </div>
                    ))}
                </div>

                <RangeSlider
                    value={selectedRange}
                    onChange={(value) => setSelectedRange(value)}
                    min={min}
                    max={max}
                    labelStepSize={stepSize}
                    disabled={isOperationDetails}
                />
            </div>

            <div className='inputs'>
                <InputGroup
                    value={selectedRange[0].toString()}
                    onValueChange={(value) => setSelectedRange([parseInt(value, 10), selectedRange[1]])}
                    fill={false}
                    small
                    disabled={isOperationDetails}
                />

                <InputGroup
                    value={selectedRange[1].toString()}
                    onValueChange={(value) => setSelectedRange([selectedRange[0], parseInt(value, 10)])}
                    fill={false}
                    small
                    disabled={isOperationDetails}
                />

                <Button
                    icon={IconNames.RESET}
                    onClick={() => setSelectedRange([min, max])}
                    minimal
                    outlined
                    small
                    disabled={isOperationDetails}
                />
            </div>
        </div>
    ) : null;
}

const getStepSize = (max: number) => (RANGE_STEP > max ? 1 : max / RANGE_STEP);

const getValidRange = (operationRange: NumberRange | null) => {
    return operationRange?.[0] !== 0 && operationRange?.[1] !== 0 ? operationRange : [0, 0];
};

export default Range;
