// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, InputGroup, NumberRange, RangeSlider, Size, Tooltip } from '@blueprintjs/core';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { useLocation } from 'react-router';
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { HttpStatusCode } from 'axios';
import {
    activePerformanceReportAtom,
    activePerformanceReportFolderNameAtom,
    activeProfilerReportAtom,
    comparisonPerformanceReportListAtom,
    filterBySignpostAtom,
    operationRangeAtom,
    performanceRangeAtom,
    selectedOperationRangeAtom,
    selectedPerformanceRangeAtom,
} from '../store/app';
import ROUTES from '../definitions/Routes';
import 'styles/components/RangeSlider.scss';
import RemountOnResize from './RemountOnResize';
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
import { PerfTableRow } from '../model/PerfTable';
import LoadingSpinner from './LoadingSpinner';
import createToastNotification from '../functions/createToastNotification';
import { ToastType } from '../definitions/ToastType';
import getResponseError from '../functions/getResponseError';
import { clampSelectionToRange } from '../functions/perfRangeSelection';
import { PERFORMANCE_LOAD_FAILED } from '../definitions/Performance';
import useTransitionalRange from '../hooks/useTransitionalRange';

const RANGE_STEP = 25;

function Range() {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const [activePerformanceReport, setActivePerformanceReport] = useAtom(activePerformanceReportAtom);
    const activeReportFolderName = useAtomValue(activePerformanceReportFolderNameAtom);
    const setOperationRange = useSetAtom(operationRangeAtom);
    const [selectedOperationRange, setSelectedOperationRange] = useAtom(selectedOperationRangeAtom);
    const setPerformanceRange = useSetAtom(performanceRangeAtom);
    const [selectedPerformanceRange, setSelectedPerformanceRange] = useAtom(selectedPerformanceRangeAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);
    const [signpostRange, setSignpostRange] = useAtom(filterBySignpostAtom);
    const hasSignpostRange = signpostRange.some((signpost) => signpost !== null);
    const [isUserOpChange, setIsUserOpChange] = useState(false);
    const [isUserPerfChange, setIsUserPerfChange] = useState(false);

    const { data: operations } = useOperationsList();
    const { data: perfData, error: perfDataError } = usePerformanceReport(activeReportFolderName);
    const { error: clusterError } = useGetClusterDescription();
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

    // The flag is set with the range, inside the same transition, so the sync effects below never
    // see a user change paired with the previous range.
    const commitPerformanceRange = useCallback(
        (value: NumberRange) => {
            setSelectedPerformanceRange(value);
            setIsUserPerfChange(true);
        },
        [setSelectedPerformanceRange],
    );
    const commitOperationRange = useCallback(
        (value: NumberRange) => {
            setSelectedOperationRange(value);
            setIsUserOpChange(true);
        },
        [setSelectedOperationRange],
    );
    const performanceSlider = useTransitionalRange(selectedPerformanceRange, commitPerformanceRange, perfRange);
    const operationSlider = useTransitionalRange(selectedOperationRange, commitOperationRange, operationRange);

    // Exact-match lookups for the sync effects, which run on every committed drag step. The first
    // occurrence wins, as `Array.find` did. An op whose perf id is unknown keeps its `undefined`
    // entry, so the forward lookup still falls through to the nearest match as before.
    const perfIdByOpId = useMemo(() => {
        const map = new Map<number, string | undefined>();

        for (const { opId, perfId } of opIdsMap) {
            if (!map.has(opId)) {
                map.set(opId, perfId);
            }
        }

        return map;
    }, [opIdsMap]);
    const opIdByPerfId = useMemo(() => {
        const map = new Map<number, number>();

        for (const { opId, perfId } of opIdsMap) {
            const key = Number(perfId);

            if (!Number.isNaN(key) && !map.has(key)) {
                map.set(key, opId);
            }
        }

        return map;
    }, [opIdsMap]);

    const operationById = useMemo(() => indexFirstById(operations, (operation) => operation.id), [operations]);
    const perfRowById = useMemo(() => indexFirstById(perfData?.report, (row) => parseInt(row.id, 10)), [perfData]);
    const renderOperationLabel = useCallback(
        (id: number, options?: { isHandleTooltip: boolean }) =>
            getOperationLabel(id, operationById, options?.isHandleTooltip),
        [operationById],
    );
    const renderPerformanceLabel = useCallback(
        (id: number, options?: { isHandleTooltip: boolean }) =>
            getPerformanceLabel(id, perfRowById, options?.isHandleTooltip),
        [perfRowById],
    );

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
            const [rangeMin, rangeMax] = perfRange;
            // Try to find matching perfIds for the selected operation range
            const matchMin =
                perfIdByOpId.get(selectedOperationRange[0]) ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs((curr.opId ?? 0) - selectedOperationRange[0]) <
                    Math.abs((prev.opId ?? 0) - selectedOperationRange[0])
                        ? curr
                        : prev,
                ).perfId;
            const matchMax =
                perfIdByOpId.get(selectedOperationRange[1]) ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs((curr.opId ?? 0) - selectedOperationRange[1]) <
                    Math.abs((prev.opId ?? 0) - selectedOperationRange[1])
                        ? curr
                        : prev,
                ).perfId;

            const updatedMin =
                Number(matchMin) ||
                (selectedOperationRange[0] < opIdsMap[0].opId ? rangeMin : selectedPerformanceRange[0]);
            const updatedMax =
                Number(matchMax) ||
                (selectedOperationRange[1] > opIdsMap[opIdsMap.length - 1].opId
                    ? rangeMax
                    : selectedPerformanceRange[1]);

            // A transition, like the drag that triggered it, so a linked tick stays interruptible
            startTransition(() =>
                setSelectedPerformanceRange(clampSelectionToRange(updatedMin, updatedMax, rangeMin, rangeMax)),
            );
            queueMicrotask(() => {
                setIsUserOpChange(false);
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInSync, selectedOperationRange]);

    // No `clampSelectionToRange` in this direction, unlike its sibling above. The
    // forward effect maps into the perf track, whose bounds come from the *view*
    // report while the ids come from the link-pinned one, so a mapped id can land
    // outside a narrowed view. Here both sides come from the operations list —
    // every `opId` in `opIdsMap` is one of its ids, and the fallbacks are the track's
    // own ends — so the result is inside the track by construction.
    useEffect(() => {
        if (
            isInSync &&
            selectedOperationRange &&
            operationRange &&
            perfRange &&
            selectedPerformanceRange &&
            isUserPerfChange
        ) {
            const [opRangeMin, opRangeMax] = operationRange;
            // Try to find matching opIds for the selected performance range
            const matchMin =
                opIdByPerfId.get(selectedPerformanceRange[0]) ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs(Number(curr.perfId) - selectedPerformanceRange[0]) <
                    Math.abs(Number(prev.perfId) - selectedPerformanceRange[0])
                        ? curr
                        : prev,
                ).opId;
            const matchMax =
                opIdByPerfId.get(selectedPerformanceRange[1]) ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs(Number(curr.perfId) - selectedPerformanceRange[1]) <
                    Math.abs(Number(prev.perfId) - selectedPerformanceRange[1])
                        ? curr
                        : prev,
                ).opId;

            const updatedMin =
                matchMin ||
                (selectedPerformanceRange[0] < Number(opIdsMap?.[0]?.perfId ?? 0)
                    ? opRangeMin
                    : selectedOperationRange[0]);
            const updatedMax =
                matchMax ||
                (selectedPerformanceRange[1] > Number(opIdsMap?.[opIdsMap.length - 1]?.perfId ?? 0)
                    ? opRangeMax
                    : selectedOperationRange[1]);

            startTransition(() => setSelectedOperationRange([updatedMin, updatedMax]));
            queueMicrotask(() => {
                setIsUserPerfChange(false);
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInSync, selectedPerformanceRange]);

    useEffect(() => {
        if (!perfDataError || !activePerformanceReport) {
            return;
        }

        // The API refuses a signpost range the report cannot honour. That is a fault in
        // the view, not the report: unloading the report would leave the range keyed to
        // it, so opening it again would be refused again. Drop the range and keep it.
        if (perfDataError.status === HttpStatusCode.BadRequest && hasSignpostRange) {
            const message = `Signpost range removed: ${getResponseError(perfDataError, PERFORMANCE_LOAD_FAILED)}`;

            createToastNotification(message, activePerformanceReport.reportName, ToastType.WARNING);
            setSignpostRange([null, null]);
            return;
        }

        const message = `Error loading report: ${getResponseError(perfDataError, PERFORMANCE_LOAD_FAILED)}`;

        createToastNotification(message, activePerformanceReport.reportName, ToastType.ERROR);
        setActivePerformanceReport(null);
    }, [perfDataError, activePerformanceReport, setActivePerformanceReport, hasSignpostRange, setSignpostRange]);

    useEffect(() => {
        if (clusterError && activeProfilerReport) {
            createToastNotification(
                'Cluster description not found, Topology unavailable',
                activeProfilerReport?.reportName,
                ToastType.WARNING,
            );
        }
    }, [clusterError, activeProfilerReport]);

    return selectedOperationRange || selectedPerformanceRange ? (
        <div className='range-slider'>
            {selectedPerformanceRange && (
                <div className='slider'>
                    <div className='inputs'>
                        <div className='group'>
                            <InputGroup
                                value={(performanceSlider.value ?? selectedPerformanceRange)[0].toString()}
                                onValueChange={(value) => {
                                    setSelectedPerformanceRange([
                                        parseInt(value, 10) || perfMin!,
                                        selectedPerformanceRange[1],
                                    ]);
                                    setIsUserPerfChange(true);
                                }}
                                fill={false}
                                disabled={!isPerformanceRoute}
                                size={Size.SMALL}
                                aria-label='Performance min value'
                            />
                            <InputGroup
                                value={(performanceSlider.value ?? selectedPerformanceRange)[1].toString()}
                                onValueChange={(value) => {
                                    setSelectedPerformanceRange([
                                        selectedPerformanceRange[0],
                                        parseInt(value, 10) || perfMax!,
                                    ]);
                                    setIsUserPerfChange(true);
                                }}
                                fill={false}
                                disabled={!isPerformanceRoute}
                                size={Size.SMALL}
                                aria-label='Performance max value'
                            />
                        </div>
                    </div>

                    {/* The panel mounts collapsed, so each slider remounts once it can measure its track */}
                    {perfMin && perfMax && selectedPerformanceRange && (
                        <RemountOnResize className='slider-container'>
                            <RangeSlider
                                value={performanceSlider.value ?? selectedPerformanceRange}
                                onChange={performanceSlider.onChange}
                                onRelease={performanceSlider.onRelease}
                                min={perfMin}
                                max={perfMax}
                                labelStepSize={getStepSize(perfMax)}
                                disabled={!isPerformanceRoute || !!comparisonReportList}
                                labelRenderer={renderPerformanceLabel}
                                handleHtmlProps={{
                                    start: { 'aria-label': 'Performance min range handle' },
                                    end: { 'aria-label': 'Performance max range handle' },
                                }}
                            />
                            <p>Performance</p>
                        </RemountOnResize>
                    )}

                    <div className='inputs'>
                        {perfRange && (
                            <Tooltip content='Reset range'>
                                <Button
                                    icon={IconNames.RESET}
                                    onClick={() => (isInSync ? resetSliders() : setSelectedPerformanceRange(perfRange))}
                                    disabled={!isPerformanceRoute}
                                    size={Size.SMALL}
                                    aria-label='Reset performance range'
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
                                value={(operationSlider.value ?? selectedOperationRange)[0].toString()}
                                onValueChange={(value) => {
                                    setSelectedOperationRange([
                                        // `operationRange` can be null while a selection from the
                                        // previous report is still in the atom, so fall back to the
                                        // current handle rather than writing `undefined` into it.
                                        parseInt(value, 10) || opMin || selectedOperationRange[0],
                                        selectedOperationRange[1],
                                    ]);
                                    setIsUserOpChange(true);
                                }}
                                fill={false}
                                disabled={shouldDisableOpRange}
                                size={Size.SMALL}
                                aria-label='Operation min value'
                            />
                            <InputGroup
                                value={(operationSlider.value ?? selectedOperationRange)[1].toString()}
                                onValueChange={(value) => {
                                    setSelectedOperationRange([
                                        selectedOperationRange[0],
                                        parseInt(value, 10) || opMax || selectedOperationRange[1],
                                    ]);
                                    setIsUserOpChange(true);
                                }}
                                fill={false}
                                disabled={shouldDisableOpRange}
                                size={Size.SMALL}
                                aria-label='Operation max value'
                            />
                        </div>
                    </div>
                )}

                {opMin && opMax && selectedOperationRange && (
                    <RemountOnResize className='slider-container'>
                        <RangeSlider
                            value={operationSlider.value ?? selectedOperationRange}
                            onChange={operationSlider.onChange}
                            onRelease={operationSlider.onRelease}
                            min={opMin}
                            max={opMax}
                            labelStepSize={getStepSize(opMax)}
                            disabled={shouldDisableOpRange}
                            labelRenderer={renderOperationLabel}
                            handleHtmlProps={{
                                start: { 'aria-label': 'Operation min range handle' },
                                end: { 'aria-label': 'Operation max range handle' },
                            }}
                        />
                        <p>Operations</p>
                    </RemountOnResize>
                )}

                {operationRange && (
                    <Tooltip content='Reset range'>
                        <Button
                            icon={IconNames.RESET}
                            onClick={() => (isInSync ? resetSliders() : setSelectedOperationRange(operationRange))}
                            disabled={shouldDisableOpRange}
                            size={Size.SMALL}
                            aria-label='Reset operation range'
                        />
                    </Tooltip>
                )}
            </div>
        </div>
    ) : (
        <LoadingSpinner />
    );
}

// The first item per id wins, so a label matches what `Array.find` used to return
const indexFirstById = <T,>(items: T[] | undefined, getId: (item: T) => number): Map<number, T> => {
    const map = new Map<number, T>();

    for (const item of items ?? []) {
        const id = getId(item);

        if (!map.has(id)) {
            map.set(id, item);
        }
    }

    return map;
};

const getStepSize = (max: number) => (RANGE_STEP > max ? 1 : Math.ceil(max / RANGE_STEP));

const getOperationLabel = (
    selectedId: number,
    operationById: Map<number, OperationDescription>,
    isTooltip?: boolean,
): string => {
    const matchingOperation = operationById.get(selectedId);

    return matchingOperation && isTooltip
        ? `${matchingOperation.id}\xA0${matchingOperation.name}`
        : selectedId.toString();
};

const getPerformanceLabel = (selectedId: number, rowById: Map<number, PerfTableRow>, isTooltip?: boolean): string => {
    const matchingRow = rowById.get(selectedId);

    return matchingRow && isTooltip ? `${matchingRow.id}\xA0${matchingRow.raw_op_code}` : selectedId.toString();
};

export default Range;
