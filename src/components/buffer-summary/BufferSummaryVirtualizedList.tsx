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
import { RankedAnnotation, TOP_N_MODE_LABEL, TopNAnnotationMode } from '../../functions/topNAnnotations';
import { perfColorScale } from '../../functions/perfOverlay';

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
    getTensorDeallocationReport?: (operationId: number) => TensorDeallocationReport[];
    getOperationTooltipContent: (operation: BuffersByOperation) => string;
    renderOperationLink: (operation: BuffersByOperation) => React.ReactNode;
}

const EMPTY_TENSOR_DEALLOCATION_REPORT: TensorDeallocationReport[] = [];
const DEFAULT_GET_TENSOR_DEALLOCATION_REPORT = () => EMPTY_TENSOR_DEALLOCATION_REPORT;
const EMPTY_ANNOTATIONS = new Map<number, RankedAnnotation>();

interface TopNCssProperties extends CSSProperties {
    '--top-n-color': string;
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
            // Double-call mirrors useBufferNavigation: a single scrollToIndex can be a no-op
            // when measurements aren't ready yet, so re-fire on the next frame to actually land.
            virtualizer.scrollToIndex(rowIndex, { align: 'center' });
            window.requestAnimationFrame(() => {
                virtualizer.scrollToIndex(rowIndex, { align: 'center' });
            });
        },
        [virtualizer],
    );

    const sortedTopNAnnotations = useMemo(
        () => [...topNAnnotationsByOpId.values()].sort((a, b) => a.rank - b.rank),
        [topNAnnotationsByOpId],
    );

    return (
        <div className='buffer-summary-chart'>
            <BufferSummaryPlotControls />

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
                                        content={getRankTooltipText(annotation, topNAnnotationMode)}
                                        placement='left'
                                    >
                                        <span
                                            className='top-n-badge'
                                            style={badgeStyle}
                                            data-rank={annotation.rank}
                                            data-testid={`top-n-badge-${operation.id}`}
                                        >
                                            #{annotation.rank}
                                        </span>
                                    </Tooltip>
                                ) : null;

                                return (
                                    <div
                                        className={classNames('buffer-summary-plot-container', {
                                            'has-top-n': annotation !== undefined,
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
                                            tensorDeallocationReport={getTensorDeallocationReport(operation.id)}
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
                                                content={getOperationTooltipContent(operation)}
                                                disabled={isVirtualizerScrolling}
                                            >
                                                {renderOperationLink(operation)}
                                            </Tooltip>
                                            {badge}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {sortedTopNAnnotations.length > 0 && operations.length > 0 ? (
                    // `<li>` carries the absolute positioning so Blueprint's
                    // Tooltip target span has non-zero geometry to anchor
                    // against — earlier the dot was the positioned element
                    // and the wrapper span collapsed to 0×0 at the rail's
                    // origin, parking every tooltip at the top.
                    <ul
                        className='top-n-rail'
                        aria-label='Top-ranked operations'
                        data-testid='top-n-rail'
                    >
                        {sortedTopNAnnotations.map((annotation) => {
                            const dotStyle: TopNCssProperties = {
                                '--top-n-color': perfColorScale(annotation.t),
                            };
                            const itemStyle: CSSProperties = {
                                top: `${(annotation.rowIndex / operations.length) * 100}%`,
                            };
                            return (
                                <li
                                    key={annotation.opId}
                                    className='top-n-rail-item'
                                    style={itemStyle}
                                >
                                    <Tooltip
                                        content={getRankTooltipText(annotation, topNAnnotationMode)}
                                        placement='left'
                                    >
                                        <button
                                            type='button'
                                            className='top-n-rail-dot'
                                            style={dotStyle}
                                            onClick={() => handleRailDotClick(annotation.rowIndex)}
                                            aria-label={`Jump to ${getRankTooltipText(annotation, topNAnnotationMode)}`}
                                            data-testid={`top-n-rail-dot-${annotation.opId}`}
                                        >
                                            {annotation.rank}
                                        </button>
                                    </Tooltip>
                                </li>
                            );
                        })}
                    </ul>
                ) : null}
            </div>
        </div>
    );
}

export default BufferSummaryVirtualizedList;
