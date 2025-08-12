// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, InputGroup, RangeSlider, Tooltip } from '@blueprintjs/core';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { useLocation } from 'react-router';
import { useEffect, useState } from 'react';
import {
    activePerformanceReportAtom,
    comparisonPerformanceReportsAtom,
    hasClusterDescriptionAtom,
    operationRangeAtom,
    performanceRangeAtom,
    selectedOperationRangeAtom,
    selectedPerformanceRangeAtom,
} from '../store/app';
import ROUTES from '../definitions/Routes';
import 'styles/components/RangeSlider.scss';
import {
    useGetClusterDescription,
    useGetDeviceOperationListPerf,
    useOpToPerfIdFiltered,
    useOperationListRange,
    useOperationsList,
    usePerformanceRange,
    usePerformanceReport,
} from '../hooks/useAPI';
import { OperationDescription } from '../model/APIData';
import { PerfTableRow } from '../definitions/PerfTable';
import LoadingSpinner from './LoadingSpinner';

const RANGE_STEP = 25;

function Range() {
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const setOperationRange = useSetAtom(operationRangeAtom);
    const [selectedOperationRange, setSelectedOperationRange] = useAtom(selectedOperationRangeAtom);
    const setPerformanceRange = useSetAtom(performanceRangeAtom);
    const [selectedPerformanceRange, setSelectedPerformanceRange] = useAtom(selectedPerformanceRangeAtom);
    const comparisonReports = useAtomValue(comparisonPerformanceReportsAtom);
    const [isUserOpChange, setIsUserOpChange] = useState(false);
    const [isUserPerfChange, setIsUserPerfChange] = useState(false);
    const setHasClusterDescription = useSetAtom(hasClusterDescriptionAtom);

    const { data: operations } = useOperationsList();
    const { data: perfData } = usePerformanceReport(activePerformanceReport);
    const { data: clusterData } = useGetClusterDescription();
    const location = useLocation();
    const listPerf = useGetDeviceOperationListPerf();
    const isInSync = listPerf?.length > 0;
    const opIdsMap = useOpToPerfIdFiltered();
    const operationRange = useOperationListRange();
    const perfRange = usePerformanceRange();

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
                Number(matchMin) ||
                (selectedOperationRange[0] < opIdsMap[0].opId ? perfMin! : selectedPerformanceRange[0]);
            const updatedMax =
                Number(matchMax) ||
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
                opIdsMap.find((op) => selectedPerformanceRange[0] === Number(op.perfId))?.opId ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs(Number(curr.perfId) - selectedPerformanceRange[0]) <
                    Math.abs(Number(prev.perfId) - selectedPerformanceRange[0])
                        ? curr
                        : prev,
                ).opId;
            const matchMax =
                opIdsMap.find((op) => selectedPerformanceRange[1] === Number(op.perfId))?.opId ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs(Number(curr.perfId) - selectedPerformanceRange[1]) <
                    Math.abs(Number(prev.perfId) - selectedPerformanceRange[1])
                        ? curr
                        : prev,
                ).opId;

            const updatedMin =
                matchMin ||
                (selectedPerformanceRange[0] < Number(opIdsMap?.[0]?.perfId ?? 0) ? opMin! : selectedOperationRange[0]);
            const updatedMax =
                matchMax ||
                (selectedPerformanceRange[1] > Number(opIdsMap?.[opIdsMap.length - 1]?.perfId ?? 0)
                    ? opMax!
                    : selectedOperationRange[1]);

            setSelectedOperationRange([updatedMin, updatedMax]);
            setIsUserPerfChange(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInSync, selectedPerformanceRange]);

    useEffect(() => {
        setHasClusterDescription(!!clusterData);
    }, [clusterData, setHasClusterDescription]);

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
                                size='small'
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
                                size='small'
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
                                disabled={!isPerformanceRoute || !!comparisonReports}
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
                                    size='small'
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
                                size='small'
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
                                size='small'
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
                            size='small'
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

const getPerformanceLabel = (selectedId: number, data?: PerfTableRow[], isTooltip?: boolean): string => {
    const matchingRow = data?.find((r) => parseInt(r.id, 10) === selectedId);

    return matchingRow && isTooltip ? `${matchingRow.id}\xA0${matchingRow.raw_op_code}` : selectedId.toString();
};

export default Range;
