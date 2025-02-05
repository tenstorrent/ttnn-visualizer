// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, InputGroup, NumberRange, RangeSlider, Tooltip } from '@blueprintjs/core';
import { useAtom, useSetAtom } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { useLocation } from 'react-router';
import { useEffect, useMemo } from 'react';
import { operationRangeAtom, selectedRangeAtom } from '../store/app';
import ROUTES from '../definitions/Routes';
import 'styles/components/RangeSlider.scss';
import { useOperationsList } from '../hooks/useAPI';
import { OperationDescription } from '../model/APIData';

const RANGE_STEP = 25;

function Range() {
    const { data: operations } = useOperationsList();
    const setOperationRange = useSetAtom(operationRangeAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedRangeAtom);
    const location = useLocation();

    const range = useMemo(
        () => (operations ? ([operations[0].id, operations[operations.length - 1].id] as NumberRange) : null),
        [operations],
    );

    useEffect(() => {
        if (range) {
            setOperationRange(range);
            setSelectedRange(null);
        }
    }, [range, setOperationRange, setSelectedRange]);

    const min = range?.[0];
    const max = range?.[1];
    const stepSize = max ? getStepSize(max) : 0;

    // const perfMin = performanceRange ? performanceRange[0] : null;
    // const perfMax = performanceRange ? performanceRange[1] : null;

    const isOperationDetails = location.pathname.includes(`${ROUTES.OPERATIONS}/`);

    // const perfAxis =
    //     perfMin && perfMax
    //         ? new Array(Math.round(perfMax / RANGE_STEP)).fill(0).map((_, index) => {
    //               // eslint-disable-next-line no-nested-ternary
    //               return index === 0
    //                   ? perfMin
    //                   : index === Math.round(perfMax / RANGE_STEP) - 1
    //                     ? perfMax
    //                     : (index + 1) * RANGE_STEP;
    //           })
    //         : [];

    useEffect(() => {
        if (!selectedRange && min && max) {
            setSelectedRange([min, max]);
        }
    }, [min, max, selectedRange, setSelectedRange]);

    return selectedRange && min && max ? (
        <div className='range-slider'>
            <div className='inputs'>
                <InputGroup
                    value={selectedRange[0].toString()}
                    onValueChange={(value) => setSelectedRange([parseInt(value, 10), selectedRange[1]])}
                    fill={false}
                    disabled={isOperationDetails}
                    small
                />

                <InputGroup
                    value={selectedRange[1].toString()}
                    onValueChange={(value) => setSelectedRange([selectedRange[0], parseInt(value, 10)])}
                    fill={false}
                    disabled={isOperationDetails}
                    small
                />
            </div>

            <div className='slider'>
                {/* <div className='alt-x-axis bp5-slider-axis'>
                    {perfAxis?.map((tick, index) => (
                        <div
                            className='bp5-slider-label'
                            data-index={index}
                            style={{ left: `${(index / (perfAxis.length - 1)) * 100}%` }}
                        >
                            {tick}
                        </div>
                    ))}
                </div> */}

                <RangeSlider
                    value={selectedRange}
                    onChange={(value) => setSelectedRange(value)}
                    min={min}
                    max={max}
                    labelStepSize={stepSize}
                    disabled={isOperationDetails}
                    labelRenderer={(id, options) => getOperationLabel(id, operations, options?.isHandleTooltip)}
                />
            </div>

            <div className='inputs'>
                <Tooltip content='Reset range'>
                    <Button
                        icon={IconNames.RESET}
                        onClick={() => setSelectedRange([min, max])}
                        disabled={isOperationDetails}
                        small
                    />
                </Tooltip>
            </div>
        </div>
    ) : null;
}

const getStepSize = (max: number) => (RANGE_STEP > max ? 1 : max / RANGE_STEP);

const getOperationLabel = (selectedId: number, operations?: OperationDescription[], isTooltip?: boolean): string => {
    const matchingOperation = operations?.find((operation) => operation.id === selectedId);

    return matchingOperation && isTooltip ? matchingOperation.name : selectedId.toString();
};

export default Range;
