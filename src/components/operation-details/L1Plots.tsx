// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { Icon, Intent, Switch } from '@blueprintjs/core';
import { Fragment } from 'react/jsx-runtime';
import { useState } from 'react';
import MemoryPlotRenderer from './MemoryPlotRenderer';
import { OperationDetails } from '../../model/OperationDetails';
import { MemoryLegendElement } from './MemoryLegendElement';
import { selectedAddressAtom, showMemoryRegionsAtom } from '../../store/app';
import {
    BufferRenderConfiguration,
    CBRenderConfiguration,
    L1RenderConfiguration,
    L1SmallRenderConfiguration,
    L1_SMALL_MARKER_COLOR,
    L1_START_MARKER_COLOR,
    MAX_LEGEND_LENGTH,
    PlotMouseEventCustom,
} from '../../definitions/PlotConfigurations';
import { BufferType } from '../../model/BufferType';
import { FragmentationEntry } from '../../model/APIData';
import { MemoryLegendGroup } from './MemoryLegendGroup';
import { useGetL1SmallMarker, useGetL1StartMarker } from '../../hooks/useAPI';

interface L1PlotsProps {
    operationDetails: OperationDetails;
    previousOperationDetails: OperationDetails;
    zoomedInViewMainMemory: boolean;
    plotZoomRangeStart: number;
    plotZoomRangeEnd: number;
    showCircularBuffer: boolean;
    showL1Small: boolean;
    onBufferClick: (event: Readonly<PlotMouseEventCustom>) => void;
    onLegendClick: (address: number, tensorId?: number) => void;
}

const MEMORY_ZOOM_PADDING_RATIO = 0.01;

function L1Plots({
    operationDetails,
    previousOperationDetails,
    zoomedInViewMainMemory,
    plotZoomRangeStart,
    plotZoomRangeEnd,
    showCircularBuffer,
    showL1Small,
    onBufferClick,
    onLegendClick,
}: L1PlotsProps) {
    const l1SmallMarker = useGetL1SmallMarker();
    const l1StartMarker = useGetL1StartMarker();
    const showMemoryRegions = useAtomValue(showMemoryRegionsAtom);
    const selectedAddress = useAtomValue(selectedAddressAtom);
    const { chartData, memory, fragmentation, cbChartData, cbChartDataByOperation, bufferChartDataByOperation } =
        operationDetails.memoryData();

    const { chartData: previousChartData } = previousOperationDetails.memoryData();
    const {
        chartData: l1SmallChartData,
        memory: l1SmallMemory,
        condensedChart: l1SmallCondensedChart,
    } = operationDetails.memoryData(BufferType.L1_SMALL);

    const cbZoomStart = operationDetails.deviceOperations
        .map((op) => op.cbList.map((cb) => cb.address))
        .flat()
        .sort((a, b) => a - b)[0];

    const cbZoomEnd = operationDetails.deviceOperations
        .map((op) => op.cbList.map((cd) => cd.address + cd.size))
        .flat()
        .sort((a, b) => a - b)
        .reverse()[0];

    const l1SmallZoomStart = l1SmallChartData
        .map((op) => op?.memoryData?.address)
        .flat()
        .sort()[0] as number;

    const l1SmallZoomEnd = l1SmallChartData
        .map((op) => (op?.memoryData ? op.memoryData.address + op.memoryData.size : 0))
        .flat()
        .sort()
        .reverse()[0] as number;

    const MEMORY_PADDING_CB = (cbZoomEnd - cbZoomStart) * MEMORY_ZOOM_PADDING_RATIO;
    const MEMORY_PADDING_L1 = (plotZoomRangeEnd - plotZoomRangeStart) * MEMORY_ZOOM_PADDING_RATIO;
    const MEMORY_PADDING_L1_SMALL = (l1SmallZoomEnd - l1SmallZoomStart) * MEMORY_ZOOM_PADDING_RATIO;

    const [zoomedInViewCBMemory, setZoomedInViewCBMemory] = useState(false);

    const { memorySizeL1, getGroupedMemoryReport } = operationDetails;

    const memoryReport: FragmentationEntry[] = [...memory, ...fragmentation].sort((a, b) => a.address - b.address);
    const groupedMemoryReport = getGroupedMemoryReport(BufferType.L1);

    const memoryReportWithCB: FragmentationEntry[] = [
        ...memoryReport,
        ...operationDetails.deviceOperations
            .map((op) =>
                op.cbList.map(
                    (cb) =>
                        ({
                            ...cb,
                            bufferType: 'CB',
                            colorVariance: op.id,
                        }) as FragmentationEntry,
                ),
            )
            .flat(),
    ].sort((a, b) => a.address - b.address);

    // keeping for now, to make sure nothing breaks
    // const bufferZoomRangeStart = Math.min(...bufferMemory.map((chunk) => chunk.address));
    // const bufferZoomRangeEnd = Math.max(...bufferMemory.map((chunk) => chunk.address + chunk.size));

    const zoomRangeStart = plotZoomRangeStart; // Math.min(plotZoomRangeStart, bufferZoomRangeStart);
    const zoomRangeEnd = plotZoomRangeEnd; // Math.max(plotZoomRangeEnd, bufferZoomRangeEnd);

    const memoryRegionsMarkers = showMemoryRegions
        ? [
              {
                  color: L1_START_MARKER_COLOR,
                  address: l1StartMarker,
              },
              {
                  color: L1_SMALL_MARKER_COLOR,
                  address: l1SmallMarker,
              },
          ]
        : [];

    return (
        <>
            <MemoryPlotRenderer
                title='Previous Summarized L1 Report'
                className={classNames('l1-memory-renderer', {
                    'empty-plot': previousChartData.length === 0,
                })}
                plotZoomRange={[zoomRangeStart - MEMORY_PADDING_L1, zoomRangeEnd + MEMORY_PADDING_L1]}
                chartDataList={[previousChartData]}
                isZoomedIn={zoomedInViewMainMemory}
                memorySize={memorySizeL1}
                configuration={L1RenderConfiguration}
                markers={memoryRegionsMarkers}
            />

            <MemoryPlotRenderer
                title='Current Summarized L1 Report'
                className={classNames('l1-memory-renderer', {
                    'empty-plot': chartData.length === 0 && cbChartDataByOperation.size === 0,
                })}
                isZoomedIn={zoomedInViewMainMemory}
                plotZoomRange={[zoomRangeStart - MEMORY_PADDING_L1, zoomRangeEnd + MEMORY_PADDING_L1]}
                chartDataList={[cbChartData, chartData, l1SmallMemory.length > 0 ? l1SmallCondensedChart : []]}
                memorySize={memorySizeL1}
                onBufferClick={onBufferClick}
                configuration={L1RenderConfiguration}
                markers={memoryRegionsMarkers}
            />
            {bufferChartDataByOperation.size > 0 && (
                <>
                    <h3>Device Operation Tensors</h3>
                    <br />

                    {[...bufferChartDataByOperation.entries()].map(
                        ([{ name: deviceOperationName }, plotData], index) => (
                            <Fragment key={`${deviceOperationName}-${index}`}>
                                <h5 className='buffers-plot-title'>
                                    <Icon
                                        className='operation-icon'
                                        size={13}
                                        intent={Intent.SUCCESS}
                                        icon={IconNames.CUBE_ADD}
                                    />{' '}
                                    <span>{deviceOperationName}</span>
                                </h5>
                                <MemoryPlotRenderer
                                    title=''
                                    className='l1-memory-renderer interm-buffers'
                                    chartDataList={[plotData]}
                                    plotZoomRange={[
                                        zoomRangeStart - MEMORY_PADDING_L1,
                                        zoomRangeEnd + MEMORY_PADDING_L1,
                                    ]}
                                    isZoomedIn={zoomedInViewMainMemory}
                                    memorySize={memorySizeL1}
                                    configuration={BufferRenderConfiguration}
                                    onBufferClick={onBufferClick}
                                    markers={memoryRegionsMarkers}
                                />
                            </Fragment>
                        ),
                    )}
                </>
            )}

            {showL1Small && (
                <MemoryPlotRenderer
                    title='Summarized L1 Small Report'
                    className={classNames('l1-memory-renderer', {
                        'empty-plot': l1SmallChartData.length === 0,
                    })}
                    isZoomedIn
                    plotZoomRange={[
                        l1SmallZoomStart - MEMORY_PADDING_L1_SMALL,
                        l1SmallZoomEnd + MEMORY_PADDING_L1_SMALL,
                    ]}
                    chartDataList={[l1SmallChartData]}
                    memorySize={memorySizeL1} // Not used as we're always zoomed in
                    configuration={L1SmallRenderConfiguration}
                    onBufferClick={() => {}}
                />
            )}

            {showCircularBuffer && cbChartDataByOperation.size > 0 && (
                <>
                    <h3>Device Operations</h3>
                    <Switch
                        label='Circular Buffers zoom'
                        checked={zoomedInViewCBMemory}
                        onChange={() => {
                            setZoomedInViewCBMemory(!zoomedInViewCBMemory);
                        }}
                    />
                    {[...cbChartDataByOperation.entries()].map(([{ name: deviceOperationName }, plotData], index) => (
                        <Fragment key={`${deviceOperationName}-${index}`}>
                            <h3 className='circular-buffers-plot-title'>
                                <Icon
                                    className='operation-icon'
                                    size={13}
                                    intent={Intent.SUCCESS}
                                    icon={IconNames.CUBE_ADD}
                                />{' '}
                                <span>{deviceOperationName}</span>
                            </h3>
                            <MemoryPlotRenderer
                                title=''
                                className={classNames('l1-memory-renderer circular-buffers', {
                                    'empty-plot': plotData.length === 0,
                                })}
                                chartDataList={[plotData]}
                                plotZoomRange={[cbZoomStart - MEMORY_PADDING_CB, cbZoomEnd + MEMORY_PADDING_CB]}
                                isZoomedIn={zoomedInViewCBMemory}
                                memorySize={memorySizeL1}
                                configuration={CBRenderConfiguration}
                                onBufferClick={onBufferClick}
                                markers={[{ color: L1_SMALL_MARKER_COLOR, address: l1SmallMarker }]}
                            />
                        </Fragment>
                    ))}
                </>
            )}

            <div
                className={classNames('legend', {
                    'lengthy-legend': memoryReport.length > MAX_LEGEND_LENGTH,
                })}
            >
                {showMemoryRegions && l1StartMarker && l1StartMarker !== 0 && (
                    <MemoryLegendElement
                        chunk={{
                            size: 0,
                            address: l1StartMarker,
                            bufferType: 'L1_START',
                        }}
                        key='l1start-marker'
                        memSize={memorySizeL1}
                        selectedTensorAddress={null}
                        operationDetails={operationDetails}
                        onLegendClick={onLegendClick}
                    />
                )}
                {showCircularBuffer &&
                    memoryReportWithCB.map((chunk, index) => (
                        <MemoryLegendElement
                            chunk={chunk}
                            key={`${chunk.address}-${index}`}
                            memSize={memorySizeL1}
                            selectedTensorAddress={selectedAddress}
                            operationDetails={operationDetails}
                            onLegendClick={onLegendClick}
                            colorVariance={chunk.colorVariance}
                        />
                    ))}

                {!showCircularBuffer &&
                    memoryReport?.map((chunk, chunkIndex) => {
                        const group = groupedMemoryReport.get(chunk.address);

                        return Array.isArray(group) && group?.length > 1 ? (
                            <MemoryLegendGroup
                                group={group}
                                key={`${chunk.address}`}
                                memSize={memorySizeL1}
                                selectedTensorAddress={selectedAddress}
                                operationDetails={operationDetails}
                                onLegendClick={onLegendClick}
                            />
                        ) : (
                            <MemoryLegendElement
                                chunk={chunk}
                                key={`${chunk.address}-${chunkIndex}`}
                                memSize={memorySizeL1}
                                selectedTensorAddress={selectedAddress}
                                operationDetails={operationDetails}
                                onLegendClick={onLegendClick}
                            />
                        );
                    })}
                {showMemoryRegions && l1SmallMarker && l1SmallMarker !== Infinity && (
                    <MemoryLegendElement
                        chunk={{
                            size: 0,
                            address: l1SmallMarker,
                            bufferType: 'L1_SMALL',
                        }}
                        key='l1small-marker'
                        memSize={memorySizeL1}
                        selectedTensorAddress={null}
                        operationDetails={operationDetails}
                        onLegendClick={onLegendClick}
                    />
                )}
            </div>
        </>
    );
}

export default L1Plots;
