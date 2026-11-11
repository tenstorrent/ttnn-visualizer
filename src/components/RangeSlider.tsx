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

    const shownPerformanceRange = performanceSlider.value ?? selectedPerformanceRange;
    const shownOperationRange = operationSlider.value ?? selectedOperationRange;

    // Exact-match lookups for the sync effects, which run on every committed drag step; the first
    // entry per id wins. An op with no matched perf row keeps its entry, whose `perfId` is
    // `undefined`, so the op-to-perf lookup falls through to the nearest-match reduce. That entry
    // keys `opEntryByPerfId` on `NaN`, which no selected perf id equals.
    const opEntryByOpId = useMemo(() => indexFirstById(opIdsMap, (entry) => entry.opId), [opIdsMap]);
    const opEntryByPerfId = useMemo(() => indexFirstById(opIdsMap, (entry) => Number(entry.perfId)), [opIdsMap]);

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
        performanceSlider.cancel();
        operationSlider.cancel();
        setSelectedOperationRange(operationRange);
        setSelectedPerformanceRange(perfRange);
    };

    const resetPerformanceSlider = (range: NumberRange) => {
        if (isInSync) {
            resetSliders();
        } else {
            performanceSlider.cancel();
            setSelectedPerformanceRange(range);
        }
    };

    const resetOperationSlider = (range: NumberRange) => {
        if (isInSync) {
            resetSliders();
        } else {
            operationSlider.cancel();
            setSelectedOperationRange(range);
        }
    };

    // Typed values apply at once, so they commit urgently rather than through the slider's transition
    const typePerformanceRange = (value: NumberRange) => {
        performanceSlider.cancel();
        commitPerformanceRange(value);
    };

    const typeOperationRange = (value: NumberRange) => {
        operationSlider.cancel();
        commitOperationRange(value);
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
                opEntryByOpId.get(selectedOperationRange[0])?.perfId ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs((curr.opId ?? 0) - selectedOperationRange[0]) <
                    Math.abs((prev.opId ?? 0) - selectedOperationRange[0])
                        ? curr
                        : prev,
                ).perfId;
            const matchMax =
                opEntryByOpId.get(selectedOperationRange[1])?.perfId ??
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
        // Runs only when the operation selection changes: re-running on a new mapping or perf range
        // would replay a stale user change, and the lookups only change together with `opIdsMap`
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
                opEntryByPerfId.get(selectedPerformanceRange[0])?.opId ??
                opIdsMap.reduce((prev, curr) =>
                    Math.abs(Number(curr.perfId) - selectedPerformanceRange[0]) <
                    Math.abs(Number(prev.perfId) - selectedPerformanceRange[0])
                        ? curr
                        : prev,
                ).opId;
            const matchMax =
                opEntryByPerfId.get(selectedPerformanceRange[1])?.opId ??
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
        // Runs only when the performance selection changes, for the same reason as its sibling above
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
                                value={shownPerformanceRange![0].toString()}
                                onValueChange={(value) =>
                                    typePerformanceRange([parseInt(value, 10) || perfMin!, selectedPerformanceRange[1]])
                                }
                                fill={false}
                                disabled={!isPerformanceRoute}
                                size={Size.SMALL}
                                aria-label='Performance min value'
                            />
                            <InputGroup
                                value={shownPerformanceRange![1].toString()}
                                onValueChange={(value) =>
                                    typePerformanceRange([selectedPerformanceRange[0], parseInt(value, 10) || perfMax!])
                                }
                                fill={false}
                                disabled={!isPerformanceRoute}
                                size={Size.SMALL}
                                aria-label='Performance max value'
                            />
                        </div>
                    </div>

                    {/* The panel mounts collapsed, so each slider remounts once it can measure its track */}
                    {perfMin && perfMax && selectedPerformanceRange && (
                        <RemountOnResize
                            className='slider-container'
                            onBlur={performanceSlider.onRelease}
                        >
                            <RangeSlider
                                value={shownPerformanceRange!}
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
                                    onClick={() => resetPerformanceSlider(perfRange)}
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
                                value={shownOperationRange![0].toString()}
                                onValueChange={(value) =>
                                    typeOperationRange([
                                        // `operationRange` can be null while a selection from the
                                        // previous report is still in the atom, so fall back to the
                                        // current handle rather than writing `undefined` into it.
                                        parseInt(value, 10) || opMin || selectedOperationRange[0],
                                        selectedOperationRange[1],
                                    ])
                                }
                                fill={false}
                                disabled={shouldDisableOpRange}
                                size={Size.SMALL}
                                aria-label='Operation min value'
                            />
                            <InputGroup
                                value={shownOperationRange![1].toString()}
                                onValueChange={(value) =>
                                    typeOperationRange([
                                        selectedOperationRange[0],
                                        parseInt(value, 10) || opMax || selectedOperationRange[1],
                                    ])
                                }
                                fill={false}
                                disabled={shouldDisableOpRange}
                                size={Size.SMALL}
                                aria-label='Operation max value'
                            />
                        </div>
                    </div>
                )}

                {opMin && opMax && selectedOperationRange && (
                    <RemountOnResize
                        className='slider-container'
                        onBlur={operationSlider.onRelease}
                    >
                        <RangeSlider
                            value={shownOperationRange!}
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
                            onClick={() => resetOperationSlider(operationRange)}
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

// The first item per id wins when ids repeat
const indexFirstById = <T,>(items: T[] | undefined, getId: (item: T) => number): Map<number, T> => {
    const itemById = new Map<number, T>();

    for (const item of items ?? []) {
        const id = getId(item);

        if (!itemById.has(id)) {
            itemById.set(id, item);
        }
    }

    return itemById;
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
