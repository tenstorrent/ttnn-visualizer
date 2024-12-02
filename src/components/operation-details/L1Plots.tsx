// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { Icon, Intent, Switch } from '@blueprintjs/core';
import { Fragment } from 'react/jsx-runtime';
import { useState } from 'react';
import MemoryPlotRenderer from './MemoryPlotRenderer';
import { OperationDetails } from '../../model/OperationDetails';
import { MemoryLegendElement } from './MemoryLegendElement';
import { selectedAddressAtom } from '../../store/app';
import {
    CBRenderConfiguration,
    CONDENSED_PLOT_CHUNK_COLOR,
    L1RenderConfiguration,
    L1SmallRenderConfiguration,
    MAX_LEGEND_LENGTH,
    PlotMouseEventCustom,
} from '../../definitions/PlotConfigurations';
import { BufferType } from '../../model/BufferType';
import { FragmentationEntry } from '../../model/APIData';

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
    const selectedAddress = useAtomValue(selectedAddressAtom);
    const {
        // nowrap
        chartData,
        memory,
        fragmentation,
        cbChartData,
        cbChartDataByOperation,
    } = operationDetails.memoryData();
    const { chartData: previousChartData } = previousOperationDetails.memoryData();

    const cbZoomStart = operationDetails.deviceOperations
        .map((op) => op.cbList.map((cb) => cb.address))
        .flat()
        .sort((a, b) => a - b)[0];

    const cbZoomEnd = operationDetails.deviceOperations
        .map((op) => op.cbList.map((cd) => cd.address + cd.size))
        .flat()
        .sort((a, b) => a - b)
        .reverse()[0];

    const MEMORY_PADDING_CB = (cbZoomEnd - cbZoomStart) * MEMORY_ZOOM_PADDING_RATIO;
    const MEMORY_PADDING_L1 = (plotZoomRangeEnd - plotZoomRangeStart) * MEMORY_ZOOM_PADDING_RATIO;

    const [zoomedInViewCBMemory, setZoomedInViewCBMemory] = useState(false);

    const { memorySizeL1 } = operationDetails;
    const l1Small = operationDetails.memoryData(BufferType.L1_SMALL);

    const l1SmallZoomStart = l1Small.condensed.address;
    const l1SmallZoomEnd = l1Small.condensed.address + l1Small.condensed.size;
    const MEMORY_PADDING_L1_SMALL = (l1SmallZoomEnd - l1SmallZoomStart) * MEMORY_ZOOM_PADDING_RATIO;

    if (l1Small.condensedChart[0] !== undefined) {
        l1Small.condensedChart[0].marker!.color = CONDENSED_PLOT_CHUNK_COLOR;
        l1Small.condensedChart[0].hovertemplate = `
<span style="color:${CONDENSED_PLOT_CHUNK_COLOR};font-size:20px;">&#9632;</span>
<br />
<span>L1 Small Condensed view</span>
<extra></extra>`;
    }

    const memoryReport: FragmentationEntry[] = [...memory, ...fragmentation].sort((a, b) => a.address - b.address);
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

    return (
        <>
            <MemoryPlotRenderer
                title='Previous Summarized L1 Report'
                className={classNames('l1-memory-renderer', {
                    'empty-plot': previousChartData.length === 0,
                })}
                plotZoomRange={[plotZoomRangeStart - MEMORY_PADDING_L1, plotZoomRangeEnd + MEMORY_PADDING_L1]}
                chartDataList={[previousChartData]}
                isZoomedIn={zoomedInViewMainMemory}
                memorySize={memorySizeL1}
                configuration={L1RenderConfiguration}
            />

            <MemoryPlotRenderer
                title='Current Summarized L1 Report'
                className={classNames('l1-memory-renderer', {
                    'empty-plot': chartData.length === 0 && cbChartDataByOperation.size === 0,
                })}
                isZoomedIn={zoomedInViewMainMemory}
                plotZoomRange={[plotZoomRangeStart - MEMORY_PADDING_L1, plotZoomRangeEnd + MEMORY_PADDING_L1]}
                chartDataList={[cbChartData, chartData]}
                memorySize={memorySizeL1}
                onBufferClick={onBufferClick}
                configuration={L1RenderConfiguration}
            />

            {showL1Small && (
                <MemoryPlotRenderer
                    title='Current Summarized L1 Small Report'
                    className={classNames('l1-memory-renderer', {
                        'empty-plot': l1Small.memory.length === 0,
                    })}
                    isZoomedIn
                    plotZoomRange={[
                        l1SmallZoomStart - MEMORY_PADDING_L1_SMALL,
                        l1SmallZoomEnd + MEMORY_PADDING_L1_SMALL,
                    ]}
                    chartDataList={[l1Small.condensedChart]}
                    memorySize={memorySizeL1}
                    onBufferClick={onBufferClick}
                    configuration={L1SmallRenderConfiguration}
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
                    memoryReport.map((chunk) => (
                        <MemoryLegendElement
                            chunk={chunk}
                            key={chunk.address}
                            memSize={memorySizeL1}
                            selectedTensorAddress={selectedAddress}
                            operationDetails={operationDetails}
                            onLegendClick={onLegendClick}
                        />
                    ))}
            </div>
        </>
    );
}

export default L1Plots;
