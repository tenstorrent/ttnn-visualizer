// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { CSSProperties, useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import { Tooltip } from '@blueprintjs/core';
import { PlotConfiguration, PlotMarker } from '../../definitions/PlotConfigurations';
import MemoryPlotRenderer from '../operation-details/MemoryPlotRenderer';
import BufferSummaryRow from './BufferSummaryRow';
import 'styles/components/BufferSummaryPlot.scss';
import { ScrollLocations } from '../../definitions/VirtualLists';
import useRestoreScrollPosition from '../../hooks/useRestoreScrollPosition';
import useScrollShade from '../../hooks/useScrollShade';
import { BuffersByOperation } from '../../model/APIData';
import useBufferNavigation from '../../hooks/useBufferNavigation';
import BufferSummaryPlotControls from './BufferSummaryPlotControls';
import { TensorDeallocationReport, TensorsByOperationByAddress } from '../../model/BufferSummary';
import { CHART_DATA, OPERATION_EL_HEIGHT, TOTAL_SHADE_HEIGHT } from '../../definitions/BufferSummary';
import {
    RankedAnnotation,
    TOP_N_MODE_LABEL,
    TOP_N_RAIL_LABEL,
    TopNAnnotationMode,
} from '../../definitions/TopNAnnotations';
import { perfColorScale } from '../../functions/perfOverlay';
import { LATE_DEALLOC_RAIL_LABEL, LateDeallocationRunStart } from '../../definitions/LateDeallocation';
import { coalesceLateDeallocationRunStarts, getLateDeallocationSummary } from '../../functions/lateDeallocation';
import { scrollVirtualizerToIndex } from '../../functions/scrollVirtualizerToIndex';
import { NavigationRailItem, RAIL_MAX_DOTS } from '../../definitions/NavigationRail';
import NavigationRail from './NavigationRail';
import LateDeallocationBadge from './LateDeallocationBadge';
import LateDeallocationGlyph from './LateDeallocationGlyph';
import { TEST_IDS } from '../../definitions/TestIds';

interface BufferSummaryVirtualizedListProps {
    operations: BuffersByOperation[];
    tensorListByOperation: TensorsByOperationByAddress;
    isZoomedIn: boolean;
    showMemoryLayout: boolean;
    scrollLocation: ScrollLocations;
    memorySize: number;
    zoomStart: number;
    zoomEnd: number;
    memoryPadding: number;
    axisConfiguration: PlotConfiguration;
    markers?: PlotMarker[];
    /**
     * Top-N op annotations (#1517). When non-empty, the matching rows get a
     * coloured rank badge in the y-tick gutter and a clickable dot on the
     * right-side minimap rail. The map is keyed by op id and is restricted to
     * ops present in the rendered `operations` slice — see
     * `selectTopNAnnotations`.
     */
    topNAnnotationsByOpId?: Map<number, RankedAnnotation>;
    /** Mode the annotations were computed for. Drives tooltip wording. */
    topNAnnotationMode?: TopNAnnotationMode;
    /**
     * Rows where a tensor goes stale (#963), plotted as a second navigation
     * rail inboard of the top-N one. Empty while the overlay toggle is off.
     */
    lateDeallocationRunStarts?: readonly LateDeallocationRunStart[];
    /**
     * How many rows qualify, passed regardless of the toggle so the control can
     * advertise the feature before it is switched on.
     */
    lateDeallocationRunCount?: number;
    getTensorDeallocationReport?: (operationId: number) => TensorDeallocationReport[];
    getOperationTooltipContent: (operation: BuffersByOperation) => string;
    renderOperationLink: (operation: BuffersByOperation) => React.ReactNode;
}

const EMPTY_TENSOR_DEALLOCATION_REPORT: TensorDeallocationReport[] = [];
const DEFAULT_GET_TENSOR_DEALLOCATION_REPORT = () => EMPTY_TENSOR_DEALLOCATION_REPORT;
const EMPTY_ANNOTATIONS = new Map<number, RankedAnnotation>();
const EMPTY_RUN_STARTS: readonly LateDeallocationRunStart[] = [];
const EMPTY_RAIL_ITEMS: readonly NavigationRailItem[] = [];

interface TopNCssProperties extends CSSProperties {
    '--top-n-color': string;
}

interface RailCssProperties extends CSSProperties {
    '--rail-columns': number;
}

const getRankTooltipText = (annotation: RankedAnnotation, mode: TopNAnnotationMode): string =>
    `#${annotation.rank} by ${TOP_N_MODE_LABEL[mode]} — ${annotation.valueLabel}`;

function BufferSummaryVirtualizedList({
    operations,
    tensorListByOperation,
    isZoomedIn,
    showMemoryLayout,
    scrollLocation,
    memorySize,
    zoomStart,
    zoomEnd,
    memoryPadding,
    axisConfiguration,
    markers,
    topNAnnotationsByOpId = EMPTY_ANNOTATIONS,
    topNAnnotationMode = TopNAnnotationMode.PERF_TIME,
    lateDeallocationRunStarts = EMPTY_RUN_STARTS,
    lateDeallocationRunCount = 0,
    getTensorDeallocationReport = DEFAULT_GET_TENSOR_DEALLOCATION_REPORT,
    getOperationTooltipContent,
    renderOperationLink,
}: BufferSummaryVirtualizedListProps) {
    const { getListState, updateListState } = useRestoreScrollPosition(scrollLocation);
    const { hasScrolledFromTop, hasScrolledToBottom, updateScrollShade, shadeClasses } = useScrollShade();
    const scrollElementRef = useRef<HTMLDivElement>(null);

    const { scrollOffset: restoredOffset, measurementsCache: restoredMeasurementsCache } =
        useMemo(() => getListState(), [getListState]) ?? {};

    // Disabling warning because it's a known limitation of Tanstack Virtual
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        estimateSize: () => OPERATION_EL_HEIGHT,
        getScrollElement: () => scrollElementRef.current,
        overscan: 10,
        initialMeasurementsCache: restoredMeasurementsCache,
        count: operations.length,
        initialOffset: restoredOffset || 0,
    });

    useBufferNavigation({
        buffersByOperation: operations,
        tensorListByOperation,
        virtualizer,
    });

    const virtualItems = virtualizer.getVirtualItems();
    const virtualHeight = virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT;
    const isVirtualizerScrolling = virtualizer.isScrolling;
    const rowMemoryStart = isZoomedIn ? zoomStart : 0;
    const rowMemoryEnd = isZoomedIn ? zoomEnd : memorySize;
    const plotMemorySize = isZoomedIn ? zoomEnd : memorySize;
    const plotZoomRange = useMemo<[number, number]>(
        () => (isZoomedIn ? [zoomStart - memoryPadding, zoomEnd + memoryPadding] : [0, memorySize]),
        [isZoomedIn, zoomStart, zoomEnd, memoryPadding, memorySize],
    );

    // Store latest values in refs for unmount cleanup
    const scrollOffsetRef = useRef(virtualizer.scrollOffset);
    const measurementsCacheRef = useRef(virtualizer.measurementsCache);
    const scrollShadeAnimationRef = useRef<number | null>(null);

    const handleUserScrolling = useCallback(() => {
        if (!scrollElementRef.current || scrollShadeAnimationRef.current !== null) {
            return;
        }

        // Avoid state churn on every scroll event callback.
        scrollShadeAnimationRef.current = window.requestAnimationFrame(() => {
            scrollShadeAnimationRef.current = null;

            if (scrollElementRef.current) {
                updateScrollShade(scrollElementRef.current);
            }
        });
    }, [updateScrollShade]);

    // Keep stored refs updated
    useEffect(() => {
        scrollOffsetRef.current = virtualizer.scrollOffset;
    }, [virtualizer.scrollOffset]);

    useEffect(() => {
        measurementsCacheRef.current = virtualizer.measurementsCache;
    }, [virtualizer.measurementsCache]);

    useEffect(
        () => () => {
            if (scrollShadeAnimationRef.current !== null) {
                window.cancelAnimationFrame(scrollShadeAnimationRef.current);
            }
        },
        [],
    );

    // Update stored list state on unmount
    useEffect(() => {
        return () => {
            updateListState({
                scrollOffset: scrollOffsetRef.current || 0,
                measurementsCache: measurementsCacheRef.current,
            });
        };
    }, [operations, updateListState]);

    const handleRailDotClick = useCallback(
        (rowIndex: number) => {
            scrollVirtualizerToIndex(virtualizer, rowIndex, { align: 'center' });
        },
        [virtualizer],
    );

    const sortedTopNAnnotations = useMemo(
        () => [...topNAnnotationsByOpId.values()].sort((a, b) => a.rank - b.rank),
        [topNAnnotationsByOpId],
    );

    // Rail items are memoised because `NavigationRail` is memoised: a fresh
    // array here would defeat the boundary that keeps the dots out of the
    // scroll-render path.
    const lateDeallocationRailItems = useMemo<readonly NavigationRailItem[]>(() => {
        if (operations.length === 0 || lateDeallocationRunStarts.length === 0) {
            return EMPTY_RAIL_ITEMS;
        }

        return coalesceLateDeallocationRunStarts({
            runStarts: lateDeallocationRunStarts,
            rowCount: operations.length,
            maxDots: RAIL_MAX_DOTS,
        }).map((runStart) => ({
            key: runStart.opId,
            rowIndex: runStart.rowIndex,
            tooltip: getLateDeallocationSummary(runStart.tensors),
            dotClassName: 'late-dealloc-rail-dot',
            dotTestId: `${TEST_IDS.LATE_DEALLOC_RAIL_DOT}-${runStart.opId}`,
            content: <LateDeallocationGlyph />,
        }));
    }, [lateDeallocationRunStarts, operations.length]);

    const topNRailItems = useMemo<readonly NavigationRailItem[]>(
        () =>
            sortedTopNAnnotations.map((annotation) => {
                const dotStyle: TopNCssProperties = {
                    '--top-n-color': perfColorScale(annotation.t),
                };

                return {
                    key: annotation.opId,
                    rowIndex: annotation.rowIndex,
                    tooltip: getRankTooltipText(annotation, topNAnnotationMode),
                    dotClassName: 'top-n-rail-dot',
                    dotTestId: `${TEST_IDS.TOP_N_RAIL_DOT}-${annotation.opId}`,
                    dotStyle,
                    content: annotation.rank,
                };
            }),
        [sortedTopNAnnotations, topNAnnotationMode],
    );

    const hasRows = operations.length > 0;
    const hasTopNRail = hasRows && sortedTopNAnnotations.length > 0;
    const hasLateDeallocationRail = hasRows && lateDeallocationRunStarts.length > 0;
    // Drives the gutter the rows and the plot give up, so an absent rail costs
    // no width. The column size itself stays in SCSS — this is only the count.
    const railStyle: RailCssProperties = {
        '--rail-columns': Number(hasTopNRail) + Number(hasLateDeallocationRail),
    };

    return (
        <div
            // `has-rank-column` tells the stylesheet the rank badges are in
            // play, so rows without one can reserve the slot and keep the
            // late-deallocation glyphs in a single scannable column.
            className={classNames('buffer-summary-chart', { 'has-rank-column': hasTopNRail })}
            style={railStyle}
        >
            <BufferSummaryPlotControls lateDeallocationRunCount={lateDeallocationRunCount} />

            <p className='x-axis-label'>Memory Address</p>

            <div className='chart-position'>
                <MemoryPlotRenderer
                    className='buffer-summary-plot'
                    chartDataList={CHART_DATA}
                    isZoomedIn={isZoomedIn}
                    memoryZoomEnd={plotMemorySize}
                    plotZoomRange={plotZoomRange}
                    configuration={axisConfiguration}
                    markers={markers}
                />
            </div>

            <div className='scrollable-with-rail'>
                <div
                    className={classNames('scrollable-element', {
                        [shadeClasses.top]: hasScrolledFromTop,
                        [shadeClasses.bottom]: !hasScrolledToBottom && operations.length > virtualItems.length,
                    })}
                    onScroll={handleUserScrolling}
                    ref={scrollElementRef}
                >
                    <div
                        style={{
                            // Div is sized to the maximum required to render all list items minus our shade element heights
                            height: virtualHeight,
                        }}
                    >
                        <div
                            className='list-container'
                            style={{
                                // Tracks scroll position
                                transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                            }}
                        >
                            {virtualItems.map((virtualRow) => {
                                const operation = operations[virtualRow.index];
                                if (!operation) {
                                    return null;
                                }

                                const annotation = topNAnnotationsByOpId.get(operation.id);
                                const badgeStyle: TopNCssProperties | undefined = annotation
                                    ? { '--top-n-color': perfColorScale(annotation.t) }
                                    : undefined;
                                const badge = annotation ? (
                                    <Tooltip
                                        className='y-axis-tick-badge'
                                        content={getRankTooltipText(annotation, topNAnnotationMode)}
                                        placement='left'
                                    >
                                        <span
                                            className='top-n-badge'
                                            style={badgeStyle}
                                            data-rank={annotation.rank}
                                            data-testid={`${TEST_IDS.TOP_N_BADGE}-${operation.id}`}
                                        >
                                            #{annotation.rank}
                                        </span>
                                    </Tooltip>
                                ) : null;

                                // The badge follows the hatching rather than the
                                // run starts the rail plots: a hatched row with
                                // an empty gutter reads as a marker that went
                                // missing, not as one finding continuing.
                                const rowLateDeallocations = getTensorDeallocationReport(operation.id);
                                const hasLateDeallocations = rowLateDeallocations.length > 0;

                                return (
                                    <div
                                        className={classNames('buffer-summary-plot-container', {
                                            'has-top-n': annotation !== undefined,
                                            'has-late-dealloc': hasLateDeallocations,
                                        })}
                                        key={virtualRow.key}
                                        data-index={virtualRow.index}
                                    >
                                        <BufferSummaryRow
                                            buffers={operation.buffers}
                                            memoryStart={rowMemoryStart}
                                            memoryEnd={rowMemoryEnd}
                                            memoryPadding={memoryPadding}
                                            tensorList={tensorListByOperation.get(operation.id)}
                                            tensorDeallocationReport={rowLateDeallocations}
                                            showMemoryLayout={showMemoryLayout}
                                            isScrolling={isVirtualizerScrolling}
                                        />

                                        {/* Row tooltip and badge tooltip are siblings, not
                                            nested — hovering the badge no longer co-fires the
                                            row tooltip. Tooltip wraps the Link directly so
                                            Blueprint's `.bp6-popover-target` is the only
                                            shrinking wrapper between the flex container and
                                            the `<a>`. */}
                                        <div className='y-axis-tick'>
                                            <Tooltip
                                                className='y-axis-tick-label'
                                                content={getOperationTooltipContent(operation)}
                                                disabled={isVirtualizerScrolling}
                                            >
                                                {renderOperationLink(operation)}
                                            </Tooltip>
                                            {/* Ordered to match the rails in the gutter:
                                                late deallocation inboard, top-N outermost. */}
                                            {hasLateDeallocations ? (
                                                <LateDeallocationBadge
                                                    operationId={operation.id}
                                                    tensors={rowLateDeallocations}
                                                    isScrolling={isVirtualizerScrolling}
                                                />
                                            ) : null}
                                            {badge}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Rails are laid out in flow order inside the track rather than
                    offset from the right edge individually, so whichever ones are
                    present pack against the scroll area and none has to know what
                    else is showing. Top-N renders last to keep the outermost
                    column when both are up. */}
                <div className='rail-track'>
                    {hasLateDeallocationRail ? (
                        <NavigationRail
                            ariaLabel={LATE_DEALLOC_RAIL_LABEL}
                            testId={TEST_IDS.LATE_DEALLOC_RAIL}
                            rowCount={operations.length}
                            items={lateDeallocationRailItems}
                            onDotClick={handleRailDotClick}
                        />
                    ) : null}

                    {hasTopNRail ? (
                        <NavigationRail
                            ariaLabel={TOP_N_RAIL_LABEL}
                            testId={TEST_IDS.TOP_N_RAIL}
                            rowCount={operations.length}
                            items={topNRailItems}
                            onDotClick={handleRailDotClick}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}

export default BufferSummaryVirtualizedList;
