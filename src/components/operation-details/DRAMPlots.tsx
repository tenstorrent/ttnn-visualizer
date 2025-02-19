// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { MemoryLegendElement } from './MemoryLegendElement';
import MemoryPlotRenderer from './MemoryPlotRenderer';
import { isEqual } from '../../functions/math';
import { DRAM_MEMORY_SIZE } from '../../definitions/DRAMMemorySize';
import {
    DRAMRenderConfiguration,
    MAX_LEGEND_LENGTH,
    PlotDataCustom,
    PlotMouseEventCustom,
} from '../../definitions/PlotConfigurations';
import { FragmentationEntry } from '../../model/APIData';
import { BufferType } from '../../model/BufferType';
import { OperationDetails } from '../../model/OperationDetails';
import { selectedAddressAtom } from '../../store/app';
import 'styles/components/DRAMPlots.scss';
import { useOperationBuffers } from '../../hooks/useAPI';
import { MemoryLegendGroup } from './MemoryLegendGroup';

const DRAM_PADDING_RATIO = 0.9998;
const SPLIT_THRESHOLD_RATIO = 8;

interface DramPlotProps {
    operationDetails: OperationDetails;
    previousOperationDetails: OperationDetails;
    zoomedInViewMainMemory: boolean;
    onDramBufferClick: (event: Readonly<PlotMouseEventCustom>) => void;
    onDramDeltaClick: (event: Readonly<PlotMouseEventCustom>) => void;
    onLegendClick: (address: number, tensorId?: number) => void;
}

function DRAMPlots({
    operationDetails,
    previousOperationDetails,
    zoomedInViewMainMemory,
    onDramBufferClick,
    onDramDeltaClick,
    onLegendClick,
}: DramPlotProps) {
    const selectedAddress = useAtomValue(selectedAddressAtom);
    const { chartData: dramData, memory: dramMemory } = operationDetails.memoryData(BufferType.DRAM);
    const { chartData: previousDramData, memory: previousDramMemory } = previousOperationDetails.memoryData(
        BufferType.DRAM,
    );
    const { data: operationBuffers } = useOperationBuffers(operationDetails.id);

    const dramHasntChanged = isEqual(dramMemory, previousDramMemory);
    const dramMemoryReport: FragmentationEntry[] = [...dramMemory].sort((a, b) => a.address - b.address);
    const dramDelta = dramMemoryReport.filter(
        (chunk) => !chunk.empty && !previousDramMemory.find((c) => c.address === chunk.address),
    );
    const reverseDramDelta = previousDramMemory.filter(
        (chunk) => !dramMemoryReport.find((c) => c.address === chunk.address),
    );
    const dramDeltaObject = operationDetails.getMemoryDelta(dramDelta, reverseDramDelta);

    let dramPlotZoomRangeStart =
        Math.min(dramMemory[0]?.address || DRAM_MEMORY_SIZE, previousDramMemory[0]?.address || DRAM_MEMORY_SIZE) *
        DRAM_PADDING_RATIO;

    let dramPlotZoomRangeEnd =
        Math.max(
            dramMemory.length > 0
                ? dramMemory[dramMemory.length - 1].address + dramMemory[dramMemory.length - 1].size
                : 0,
            previousDramMemory.length > 0
                ? previousDramMemory[previousDramMemory.length - 1].address +
                      previousDramMemory[previousDramMemory.length - 1].size
                : 0,
        ) *
        (1 / DRAM_PADDING_RATIO);

    if (dramPlotZoomRangeEnd < dramPlotZoomRangeStart) {
        dramPlotZoomRangeStart = 0;
        dramPlotZoomRangeEnd = DRAM_MEMORY_SIZE;
    }

    // TODO: Replace with deviceBuffers
    const groupedMemoryReport = operationBuffers?.buffers
        ?.filter((buffer) => buffer.buffer_type === BufferType.DRAM)
        .reduce((acc: FragmentationEntry[][], entry: FragmentationEntry) => {
            const group = acc.find((g) => g[0].address === entry.address);
            if (group) {
                group.push(entry);
            } else {
                acc.push([entry]);
            }
            return acc;
        }, []) as FragmentationEntry[][];

    const splitPreviousDramData = useMemo(() => splitData(previousDramData), [previousDramData]);
    const splitDramData = useMemo(() => splitData(dramData), [dramData]);

    return (
        <>
            <h3 className='plot-title'>Previous Summarized DRAM Report {dramHasntChanged ? ' (No changes)' : ''}</h3>
            <div className='zoomed-dram-plots'>
                {zoomedInViewMainMemory && previousDramData.length > 0 ? (
                    splitPreviousDramData.map((data, index) => {
                        const firstDataPoint = data[0];
                        const lastDataPoint = data.at(-1);

                        if (!firstDataPoint.memoryData || !lastDataPoint?.memoryData) {
                            return null;
                        }

                        const dramNonContinuousPlotZoomRangeStart =
                            firstDataPoint.memoryData.address || DRAM_MEMORY_SIZE * DRAM_PADDING_RATIO;
                        const dramNonContinuousPlotZoomRangeEnd =
                            lastDataPoint.memoryData.address + lastDataPoint.memoryData.size * (1 / DRAM_PADDING_RATIO);

                        if (dramPlotZoomRangeEnd < dramPlotZoomRangeStart) {
                            dramPlotZoomRangeStart = 0;
                            dramPlotZoomRangeEnd = DRAM_MEMORY_SIZE;
                        }

                        return (
                            <MemoryPlotRenderer
                                key={index}
                                className={classNames('dram-memory-renderer', {
                                    'empty-plot': dramData.length === 0,
                                })}
                                style={{ flexBasis: calculateWidth(splitPreviousDramData)[index] }}
                                plotZoomRange={[dramNonContinuousPlotZoomRangeStart, dramNonContinuousPlotZoomRangeEnd]}
                                chartDataList={[data]}
                                isZoomedIn
                                memorySize={DRAM_MEMORY_SIZE}
                                onBufferClick={onDramBufferClick}
                                configuration={{
                                    ...DRAMRenderConfiguration,
                                    ...getPlotConfig(
                                        dramNonContinuousPlotZoomRangeStart,
                                        dramNonContinuousPlotZoomRangeEnd,
                                    ),
                                }}
                            />
                        );
                    })
                ) : (
                    <MemoryPlotRenderer
                        className={classNames('dram-memory-renderer', {
                            'empty-plot': previousDramData.length === 0,
                            'identical-plot': dramHasntChanged,
                        })}
                        plotZoomRange={[dramPlotZoomRangeStart, dramPlotZoomRangeEnd]}
                        chartDataList={[previousDramData]}
                        isZoomedIn={zoomedInViewMainMemory}
                        memorySize={DRAM_MEMORY_SIZE}
                        configuration={DRAMRenderConfiguration}
                    />
                )}
            </div>

            <h3 className='plot-title'>Current Summarized DRAM Report</h3>
            <div className='zoomed-dram-plots'>
                {zoomedInViewMainMemory && dramData.length > 0 ? (
                    splitDramData.map((data, index) => {
                        const firstDataPoint = data[0];
                        const lastDataPoint = data.at(-1);

                        if (!firstDataPoint.memoryData || !lastDataPoint?.memoryData) {
                            return null;
                        }

                        const dramNonContinuousPlotZoomRangeStart =
                            firstDataPoint.memoryData.address || DRAM_MEMORY_SIZE * DRAM_PADDING_RATIO;
                        const dramNonContinuousPlotZoomRangeEnd =
                            lastDataPoint.memoryData.address + lastDataPoint.memoryData.size * (1 / DRAM_PADDING_RATIO);

                        if (dramPlotZoomRangeEnd < dramPlotZoomRangeStart) {
                            dramPlotZoomRangeStart = 0;
                            dramPlotZoomRangeEnd = DRAM_MEMORY_SIZE;
                        }

                        return (
                            <MemoryPlotRenderer
                                key={index}
                                className={classNames('dram-memory-renderer', {
                                    'empty-plot': dramData.length === 0,
                                })}
                                style={{ flexBasis: calculateWidth(splitPreviousDramData)[index] }}
                                plotZoomRange={[dramNonContinuousPlotZoomRangeStart, dramNonContinuousPlotZoomRangeEnd]}
                                chartDataList={[data]}
                                isZoomedIn
                                memorySize={DRAM_MEMORY_SIZE}
                                onBufferClick={onDramBufferClick}
                                configuration={{
                                    ...DRAMRenderConfiguration,
                                    ...getPlotConfig(
                                        dramNonContinuousPlotZoomRangeStart,
                                        dramNonContinuousPlotZoomRangeEnd,
                                    ),
                                }}
                            />
                        );
                    })
                ) : (
                    <MemoryPlotRenderer
                        className={classNames('dram-memory-renderer', {
                            'empty-plot': dramData.length === 0,
                        })}
                        plotZoomRange={[dramPlotZoomRangeStart, dramPlotZoomRangeEnd]}
                        chartDataList={[dramData]}
                        isZoomedIn={zoomedInViewMainMemory}
                        memorySize={DRAM_MEMORY_SIZE}
                        onBufferClick={onDramBufferClick}
                        configuration={DRAMRenderConfiguration}
                    />
                )}
            </div>

            <h3 className='plot-title'>DRAM Delta (difference between current and previous operation)</h3>
            <MemoryPlotRenderer
                className={classNames('dram-memory-renderer', {
                    'empty-plot': dramDeltaObject.chartData.length === 0,
                })}
                plotZoomRange={[dramPlotZoomRangeStart, dramPlotZoomRangeEnd]}
                chartDataList={[dramDeltaObject.chartData]}
                isZoomedIn={zoomedInViewMainMemory}
                memorySize={DRAM_MEMORY_SIZE}
                onBufferClick={onDramDeltaClick}
                configuration={DRAMRenderConfiguration}
            />

            <div
                className={classNames('legend', {
                    'lengthy-legend': dramMemoryReport.length > MAX_LEGEND_LENGTH,
                })}
            >
                {groupedMemoryReport?.map((group, groupIndex) =>
                    group.length === 1 ? (
                        <MemoryLegendElement
                            chunk={group[0]}
                            key={`${group[0].address}-${groupIndex}`}
                            memSize={DRAM_MEMORY_SIZE}
                            selectedTensorAddress={selectedAddress}
                            operationDetails={operationDetails}
                            onLegendClick={onLegendClick}
                        />
                    ) : (
                        <MemoryLegendGroup
                            group={group}
                            key={`${group[0].address}-${groupIndex}`}
                            memSize={DRAM_MEMORY_SIZE}
                            selectedTensorAddress={selectedAddress}
                            operationDetails={operationDetails}
                            onLegendClick={onLegendClick}
                        />
                    ),
                )}
            </div>
        </>
    );
}

const getPlotConfig = (
    start: number,
    end: number,
): {
    title: string;
    xAxis: {
        tickmode: 'array' | 'linear' | 'auto';
        tickvals: number[];
    };
} => ({
    title: '',
    xAxis: {
        tickmode: 'array',
        tickvals: [start, end],
    },
});

const splitData = (data: Partial<PlotDataCustom>[]) => {
    const result = [];
    const lastDataPoint = data.at(-1)?.memoryData;
    const splitThreshold = lastDataPoint ? (lastDataPoint.address + lastDataPoint.size) / SPLIT_THRESHOLD_RATIO : 0;
    let currentArray = [];

    for (let i = 0; i < data.length; i++) {
        const thisPosition = data?.[i]?.x?.[0] as number;
        const lastPosition = data?.[i - 1]?.x?.[0] as number;

        if (thisPosition - lastPosition > splitThreshold) {
            result.push(currentArray);
            currentArray = [];
        }

        currentArray.push(data[i]);
    }

    if (currentArray.length > 0) {
        result.push(currentArray);
    }

    return result;
};

const calculateWidth = (data: Partial<PlotDataCustom>[][]) => {
    const totalWidth = data.reduce(
        (total, subArray) =>
            total + subArray.reduce((subTotal, item) => (item.memoryData ? subTotal + item.memoryData.size : 0), 0),
        0,
    );

    return data.map((subArray) => {
        const subArrayWidth = subArray.reduce(
            (subTotal, item) => (item.memoryData ? subTotal + item.memoryData.size : 0),
            0,
        );

        const percentage = (subArrayWidth / totalWidth) * 100;

        return percentage < 20 ? '200px' : `${percentage}%`;
    });
};

export default DRAMPlots;
