// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, InputGroup, NumberRange, RangeSlider, Tooltip } from '@blueprintjs/core';
import { useAtom, useSetAtom } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { useLocation } from 'react-router';
import { useEffect, useMemo, useState } from 'react';
import {
    operationRangeAtom,
    performanceRangeAtom,
    selectedOperationRangeAtom,
    selectedPerformanceRangeAtom,
} from '../store/app';
import ROUTES from '../definitions/Routes';
import 'styles/components/RangeSlider.scss';
import {
    useGetDeviceOperationListPerf,
    useNormalizedPerformance,
    useOperationsList,
    useOptoPerfIdFiltered,
} from '../hooks/useAPI';
import { OperationDescription } from '../model/APIData';
import { RowData } from '../definitions/PerfTable';

const RANGE_STEP = 25;

function Range() {
    const { data: operations } = useOperationsList();
    const perfData = useNormalizedPerformance();
    const location = useLocation();
    const listPerf = useGetDeviceOperationListPerf();
    const isInSync = listPerf?.length > 0;
    const opIdsMap = useOptoPerfIdFiltered();

    const setOperationRange = useSetAtom(operationRangeAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedOperationRangeAtom);
    const setPerformanceRange = useSetAtom(performanceRangeAtom);
    const [selectedPerformanceRange, setSelectedPerformanceRange] = useAtom(selectedPerformanceRangeAtom);
    const [isUserOpChange, setIsUserOpChange] = useState(false);
    const [isUserPerfChange, setIsUserPerfChange] = useState(false);

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
    const isPerformanceRoute = location.pathname === ROUTES.PERFORMANCE;
    const shouldDisableOpRange = isOperationDetails || (isPerformanceRoute && !isInSync);

    useEffect(() => {
        if (range) {
            setOperationRange(range);
            setSelectedRange(range);
        }
    }, [range, setOperationRange, setSelectedRange]);

    useEffect(() => {
        if (perfRange) {
            setPerformanceRange(perfRange);
            setSelectedPerformanceRange(perfRange);
        }
    }, [perfRange, setPerformanceRange, setSelectedPerformanceRange]);

    useEffect(() => {
        if (isInSync && selectedRange && perfRange && selectedPerformanceRange && isUserOpChange) {
            const updatedMin = opIdsMap.find((op) => selectedRange[0] === op.opId)?.perfId;
            const updatedMax = opIdsMap.find((op) => selectedRange[1] === op.opId)?.perfId;

            if (updatedMin || updatedMax) {
                setSelectedPerformanceRange([
                    updatedMin || selectedPerformanceRange[0],
                    updatedMax || selectedPerformanceRange[1],
                ]);
                setIsUserOpChange(false);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInSync, selectedRange]);

    useEffect(() => {
        if (isInSync && selectedRange && perfRange && selectedPerformanceRange && isUserPerfChange) {
            const updatedMin = opIdsMap.find((op) => selectedPerformanceRange[0] === op.perfId)?.opId;
            const updatedMax = opIdsMap.find((op) => selectedPerformanceRange[1] === op.perfId)?.opId;

            if (updatedMin || updatedMax) {
                setSelectedRange([updatedMin || selectedRange[0], updatedMax || selectedRange[1]]);
                setIsUserPerfChange(false);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInSync, selectedPerformanceRange]);

    return selectedRange || selectedPerformanceRange ? (
        <div className='range-slider'>
            {selectedPerformanceRange && (
                <div className='slider'>
                    <div className='inputs'>
                        <div className='group'>
                            <InputGroup
                                value={selectedPerformanceRange[0].toString()}
                                onValueChange={(value) => {
                                    setSelectedPerformanceRange([
                                        parseInt(value, 10) || perfMin!,
                                        selectedPerformanceRange[1],
                                    ]);
                                    setIsUserPerfChange(true);
                                }}
                                fill={false}
                                disabled={!isPerformanceRoute}
                                small
                            />
                            <InputGroup
                                value={selectedPerformanceRange[1].toString()}
                                onValueChange={(value) => {
                                    setSelectedPerformanceRange([
                                        selectedPerformanceRange[0],
                                        parseInt(value, 10) || perfMax!,
                                    ]);
                                    setIsUserPerfChange(true);
                                }}
                                fill={false}
                                disabled={!isPerformanceRoute}
                                small
                            />
                        </div>
                    </div>

                    {perfMin && perfMax && selectedPerformanceRange && (
                        <div className='slider-container'>
                            <RangeSlider
                                value={selectedPerformanceRange}
                                onChange={(value) => {
                                    setSelectedPerformanceRange(value);
                                    setIsUserPerfChange(true);
                                }}
                                min={perfMin}
                                max={perfMax}
                                labelStepSize={getStepSize(perfMax)}
                                disabled={!isPerformanceRoute}
                                labelRenderer={(id, options) =>
                                    getPerformanceLabel(id, perfData, options?.isHandleTooltip)
                                }
                            />
                            <p>Performance</p>
                        </div>
                    )}

                    <div className='inputs'>
                        {perfMin && perfMax && (
                            <Tooltip content='Reset range'>
                                <Button
                                    icon={IconNames.RESET}
                                    onClick={() => setSelectedPerformanceRange([perfMin, perfMax])}
                                    disabled={!isPerformanceRoute}
                                    small
                                />
                            </Tooltip>
                        )}
                    </div>
                </div>
            )}

            <div className='slider'>
                {selectedRange && (
                    <div className='inputs'>
                        <div className='group'>
                            <InputGroup
                                value={selectedRange[0].toString()}
                                onValueChange={(value) => {
                                    setSelectedRange([parseInt(value, 10) || min!, selectedRange[1]]);
                                    setIsUserOpChange(true);
                                }}
                                fill={false}
                                disabled={shouldDisableOpRange}
                                small
                            />
                            <InputGroup
                                value={selectedRange[1].toString()}
                                onValueChange={(value) => {
                                    setSelectedRange([selectedRange[0], parseInt(value, 10) || max!]);
                                    setIsUserOpChange(true);
                                }}
                                fill={false}
                                disabled={shouldDisableOpRange}
                                small
                            />
                        </div>
                    </div>
                )}

                {min && max && selectedRange && (
                    <div className='slider-container'>
                        <RangeSlider
                            value={selectedRange}
                            onChange={(value) => {
                                setSelectedRange(value);
                                setIsUserOpChange(true);
                            }}
                            min={min}
                            max={max}
                            labelStepSize={getStepSize(max)}
                            disabled={shouldDisableOpRange}
                            labelRenderer={(id, options) => getOperationLabel(id, operations, options?.isHandleTooltip)}
                        />
                        <p>Operations</p>
                    </div>
                )}

                {min && max && (
                    <Tooltip content='Reset range'>
                        <Button
                            icon={IconNames.RESET}
                            onClick={() => setSelectedRange([min, max])}
                            disabled={shouldDisableOpRange}
                            small
                        />
                    </Tooltip>
                )}
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

const getPerformanceLabel = (selectedId: number, data?: RowData[], isTooltip?: boolean): string => {
    const matchingRow = data?.find((r) => r.ORIGINAL_ID === selectedId);

    return matchingRow && isTooltip ? `${matchingRow.ORIGINAL_ID}\xA0${matchingRow['OP CODE']}` : selectedId.toString();
};

export default Range;
