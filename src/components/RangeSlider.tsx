// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, InputGroup, NumberRange, RangeSlider, Tooltip } from '@blueprintjs/core';
import { useAtom, useSetAtom } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { useLocation } from 'react-router';
import { useEffect, useMemo } from 'react';
import { operationRangeAtom, performanceRangeAtom, selectedRangeAtom } from '../store/app';
import ROUTES from '../definitions/Routes';
import 'styles/components/RangeSlider.scss';
import { useNormalizedPerformance, useOperationsList } from '../hooks/useAPI';
import { OperationDescription } from '../model/APIData';

const RANGE_STEP = 25;

function Range() {
    const { data: operations } = useOperationsList();
    const perfData = useNormalizedPerformance();
    const location = useLocation();

    const setOperationRange = useSetAtom(operationRangeAtom);
    const setPerformanceRange = useSetAtom(performanceRangeAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedRangeAtom);

    const range = useMemo(
        () => (operations ? ([operations?.[0].id, operations?.[operations.length - 1].id] as NumberRange) : null),
        [operations],
    );
    const min = range?.[0];
    const max = range?.[1];

    const perfRange = useMemo(
        () =>
            perfData?.length
                ? ([perfData[0].ORIGINAL_ID, perfData[perfData.length - 1].ORIGINAL_ID] as NumberRange)
                : null,
        [perfData],
    );
    const perfMin = perfRange?.[0];
    const perfMax = perfRange?.[1];

    const isOperationDetails = location.pathname.includes(`${ROUTES.OPERATIONS}/`);
    const isPerformance = location.pathname === ROUTES.PERFORMANCE;

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
    //         : [];.

    const isPerformanceMode = useMemo(() => perfRange && isPerformance, [perfRange, isPerformance]);
    const computedMin = useMemo(() => (isPerformanceMode ? perfMin : min), [isPerformanceMode, perfMin, min]);
    const computedMax = useMemo(() => (isPerformanceMode ? perfMax : max), [isPerformanceMode, perfMax, max]);
    const stepSize = computedMax ? getStepSize(computedMax) : 0;

    useEffect(() => {
        if (range) {
            setOperationRange(range);
        }

        if (perfRange) {
            setPerformanceRange(perfRange);
        }

        if (
            computedMin !== undefined &&
            computedMax !== undefined &&
            ((selectedRange?.[0] ?? computedMin) < computedMin || (selectedRange?.[1] ?? computedMax) > computedMax)
        ) {
            setSelectedRange([computedMin, computedMax]);
        }
    }, [
        range,
        setOperationRange,
        perfRange,
        setPerformanceRange,
        computedMin,
        computedMax,
        selectedRange,
        setSelectedRange,
    ]);

    useEffect(() => {
        if (!selectedRange && computedMin && computedMax) {
            setSelectedRange([computedMin, computedMax]);
        }
    }, [computedMin, computedMax, selectedRange, setSelectedRange]);

    useEffect(() => {
        if (!selectedRange && min && max) {
            setSelectedRange([min, max]);
        }
    }, [min, max, selectedRange, setSelectedRange]);

    return selectedRange && computedMin && computedMax ? (
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
                    min={computedMin}
                    max={computedMax}
                    labelStepSize={stepSize}
                    disabled={isOperationDetails}
                    labelRenderer={(id, options) => getOperationLabel(id, operations, options?.isHandleTooltip)}
                />
            </div>

            <div className='inputs'>
                <Tooltip content='Reset range'>
                    <Button
                        icon={IconNames.RESET}
                        onClick={() => setSelectedRange([computedMin, computedMax])}
                        disabled={isOperationDetails}
                        small
                    />
                </Tooltip>
            </div>
        </div>
    ) : null;
}

const getStepSize = (max: number) => (RANGE_STEP > max ? 1 : Math.ceil(max / RANGE_STEP));

const getOperationLabel = (selectedId: number, operations?: OperationDescription[], isTooltip?: boolean): string => {
    const matchingOperation = operations?.find((operation) => operation.id === selectedId);

    return matchingOperation && isTooltip
        ? `${matchingOperation.id}\xA0${matchingOperation.name}`
        : selectedId.toString();
};

export default Range;
