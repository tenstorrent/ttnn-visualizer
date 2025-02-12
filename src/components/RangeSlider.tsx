// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, InputGroup, RangeSlider, Tooltip } from '@blueprintjs/core';
import { useAtom, useSetAtom } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { useLocation } from 'react-router';
import { useEffect, useState } from 'react';
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
    useOperationListRange,
    useOperationsList,
    useOptoPerfIdFiltered,
    usePerformanceRange,
} from '../hooks/useAPI';
import { OperationDescription } from '../model/APIData';
import { RowData } from '../definitions/PerfTable';
import LoadingSpinner from './LoadingSpinner';

const RANGE_STEP = 25;

function Range() {
    const { data: operations } = useOperationsList();
    const perfData = useNormalizedPerformance();
    const location = useLocation();
    const listPerf = useGetDeviceOperationListPerf();
    const isInSync = listPerf?.length > 0;
    const opIdsMap = useOptoPerfIdFiltered();
    const operationRange = useOperationListRange();
    const perfRange = usePerformanceRange();

    const setOperationRange = useSetAtom(operationRangeAtom);
    const [selectedOperationRange, setSelectedOperationRange] = useAtom(selectedOperationRangeAtom);
    const setPerformanceRange = useSetAtom(performanceRangeAtom);
    const [selectedPerformanceRange, setSelectedPerformanceRange] = useAtom(selectedPerformanceRangeAtom);
    const [isUserOpChange, setIsUserOpChange] = useState(false);
    const [isUserPerfChange, setIsUserPerfChange] = useState(false);

    const opMin = operationRange?.[0];
    const opMax = operationRange?.[1];
    const perfMin = perfRange?.[0];
    const perfMax = perfRange?.[1];

    const isOperationDetails = location.pathname.includes(`${ROUTES.OPERATIONS}/`);
    const isPerformanceRoute = location.pathname === ROUTES.PERFORMANCE;
    const shouldDisableOpRange = isOperationDetails || isPerformanceRoute;

    const resetSliders = () => {
        setSelectedOperationRange(operationRange);
        setSelectedPerformanceRange(perfRange);
    };

    useEffect(() => {
        if (operationRange) {
            setOperationRange(operationRange);
            setSelectedOperationRange(operationRange);
        }
    }, [operationRange, setOperationRange, setSelectedOperationRange]);

    useEffect(() => {
        if (perfRange) {
            setPerformanceRange(perfRange);
            setSelectedPerformanceRange(perfRange);
        }
    }, [perfRange, setPerformanceRange, setSelectedPerformanceRange]);

    useEffect(() => {
        if (isInSync && selectedOperationRange && perfRange && selectedPerformanceRange && isUserOpChange) {
            // Try to find matching perfIds for the selected operation range
            const matchMin =
                opIdsMap.find((op) => selectedOperationRange[0] === op.opId)?.perfId ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs((curr.opId ?? 0) - selectedOperationRange[0]) <
                    Math.abs((prev.opId ?? 0) - selectedOperationRange[0])
                        ? curr
                        : prev,
                ).perfId;
            const matchMax =
                opIdsMap.find((op) => selectedOperationRange[1] === op.opId)?.perfId ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs((curr.opId ?? 0) - selectedOperationRange[1]) <
                    Math.abs((prev.opId ?? 0) - selectedOperationRange[1])
                        ? curr
                        : prev,
                ).perfId;

            const updatedMin =
                matchMin || (selectedOperationRange[0] < opIdsMap[0].opId ? perfMin! : selectedPerformanceRange[0]);
            const updatedMax =
                matchMax ||
                (selectedOperationRange[1] > opIdsMap[opIdsMap.length - 1].opId
                    ? perfMax!
                    : selectedPerformanceRange[1]);

            setSelectedPerformanceRange([updatedMin, updatedMax]);
            setIsUserOpChange(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInSync, selectedOperationRange]);

    useEffect(() => {
        if (isInSync && selectedOperationRange && perfRange && selectedPerformanceRange && isUserPerfChange) {
            // Try to find matching opIds for the selected performance range
            const matchMin =
                opIdsMap.find((op) => selectedPerformanceRange[0] === op.perfId)?.opId ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs((curr.perfId ?? 0) - selectedPerformanceRange[0]) <
                    Math.abs((prev.perfId ?? 0) - selectedPerformanceRange[0])
                        ? curr
                        : prev,
                ).opId;
            const matchMax =
                opIdsMap.find((op) => selectedPerformanceRange[1] === op.perfId)?.opId ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs((curr.perfId ?? 0) - selectedPerformanceRange[1]) <
                    Math.abs((prev.perfId ?? 0) - selectedPerformanceRange[1])
                        ? curr
                        : prev,
                ).opId;

            const updatedMin =
                matchMin ||
                (selectedPerformanceRange[0] < (opIdsMap?.[0]?.perfId ?? 0) ? opMin! : selectedOperationRange[0]);
            const updatedMax =
                matchMax ||
                (selectedPerformanceRange[1] > (opIdsMap?.[opIdsMap.length - 1]?.perfId ?? 0)
                    ? opMax!
                    : selectedOperationRange[1]);

            setSelectedOperationRange([updatedMin, updatedMax]);
            setIsUserPerfChange(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInSync, selectedPerformanceRange]);

    return selectedOperationRange || selectedPerformanceRange ? (
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
                        {perfRange && (
                            <Tooltip content='Reset range'>
                                <Button
                                    icon={IconNames.RESET}
                                    onClick={() => (isInSync ? resetSliders() : setSelectedPerformanceRange(perfRange))}
                                    disabled={!isPerformanceRoute}
                                    small
                                />
                            </Tooltip>
                        )}
                    </div>
                </div>
            )}

            <div className='slider'>
                {selectedOperationRange && (
                    <div className='inputs'>
                        <div className='group'>
                            <InputGroup
                                value={selectedOperationRange[0].toString()}
                                onValueChange={(value) => {
                                    setSelectedOperationRange([
                                        parseInt(value, 10) || opMin!,
                                        selectedOperationRange[1],
                                    ]);
                                    setIsUserOpChange(true);
                                }}
                                fill={false}
                                disabled={shouldDisableOpRange}
                                small
                            />
                            <InputGroup
                                value={selectedOperationRange[1].toString()}
                                onValueChange={(value) => {
                                    setSelectedOperationRange([
                                        selectedOperationRange[0],
                                        parseInt(value, 10) || opMax!,
                                    ]);
                                    setIsUserOpChange(true);
                                }}
                                fill={false}
                                disabled={shouldDisableOpRange}
                                small
                            />
                        </div>
                    </div>
                )}

                {opMin && opMax && selectedOperationRange && (
                    <div className='slider-container'>
                        <RangeSlider
                            value={selectedOperationRange}
                            onChange={(value) => {
                                setSelectedOperationRange(value);
                                setIsUserOpChange(true);
                            }}
                            min={opMin}
                            max={opMax}
                            labelStepSize={getStepSize(opMax)}
                            disabled={shouldDisableOpRange}
                            labelRenderer={(id, options) => getOperationLabel(id, operations, options?.isHandleTooltip)}
                        />
                        <p>Operations</p>
                    </div>
                )}

                {operationRange && (
                    <Tooltip content='Reset range'>
                        <Button
                            icon={IconNames.RESET}
                            onClick={() => (isInSync ? resetSliders() : setSelectedOperationRange(operationRange))}
                            disabled={shouldDisableOpRange}
                            small
                        />
                    </Tooltip>
                )}
            </div>
        </div>
    ) : (
        <LoadingSpinner />
    );
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
