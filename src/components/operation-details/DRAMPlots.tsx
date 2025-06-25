// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { useAtomValue } from 'jotai';
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
import { MemoryLegendGroup } from './MemoryLegendGroup';

const DRAM_PADDING_RATIO = 0.9998;
const SPLIT_THRESHOLD_RATIO = 8;
const EMPTY_CHART: Partial<PlotDataCustom>[] = [];

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
    const dramHasntChanged = isEqual(dramMemory, previousDramMemory);
    const dramMemoryReport: FragmentationEntry[] = [...dramMemory].sort((a, b) => a.address - b.address);
    const dramDelta = dramMemoryReport.filter(
        (chunk) => !chunk.empty && !previousDramMemory.find((c) => c.address === chunk.address),
    );
    const reverseDramDelta = previousDramMemory.filter(
        (chunk) => !dramMemoryReport.find((c) => c.address === chunk.address),
    );
    const dramDeltaObject = operationDetails.getMemoryDelta(dramDelta, reverseDramDelta);
    const { getGroupedMemoryReport } = operationDetails;

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

    const groupedMemoryReport = getGroupedMemoryReport(BufferType.DRAM);
    let splitPreviousDramData = splitData(previousDramData);
    let splitDramData = splitData(dramData);
    let splitDeltaData = splitData(dramDeltaObject.chartData);

    const zoomedPlotSizes = getZoomedPlotSizes(splitPreviousDramData, splitDramData);

    // Fill empty spaces in split data arrays so their data indexes match zoomedPlotSizes
    splitPreviousDramData = fillEmptySpaces(zoomedPlotSizes, splitPreviousDramData);
    splitDramData = fillEmptySpaces(zoomedPlotSizes, splitDramData);
    splitDeltaData = fillEmptySpaces(zoomedPlotSizes, splitDeltaData);

    return (
        <>
            <h3 className='plot-title'>Previous Summarized DRAM Report {dramHasntChanged ? ' (No changes)' : ''}</h3>
            <div className='zoomed-dram-plots'>
                {zoomedInViewMainMemory && zoomedPlotSizes.length > 0 ? (
                    zoomedPlotSizes.map((data, index) => {
                        const chartData = splitPreviousDramData[index] ?? EMPTY_CHART;

                        if (dramPlotZoomRangeEnd < dramPlotZoomRangeStart) {
                            dramPlotZoomRangeStart = 0;
                            dramPlotZoomRangeEnd = DRAM_MEMORY_SIZE;
                        }

                        const dramNonContinuousPlotZoomRangeStart = data.min;
                        const dramNonContinuousPlotZoomRangeEnd = data.max;

                        return (
                            <MemoryPlotRenderer
                                key={index}
                                className={classNames('dram-memory-renderer', {
                                    'empty-plot': previousDramData.length === 0,
                                    'identical-plot': dramHasntChanged,
                                })}
                                style={{ flexBasis: calculateWidth(splitPreviousDramData)[index] }}
                                plotZoomRange={[dramNonContinuousPlotZoomRangeStart, dramNonContinuousPlotZoomRangeEnd]}
                                chartDataList={[chartData]}
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
                {zoomedInViewMainMemory && zoomedPlotSizes.length > 0 ? (
                    zoomedPlotSizes.map((data, index) => {
                        const dramNonContinuousPlotZoomRangeStart = data.min;
                        const dramNonContinuousPlotZoomRangeEnd = data.max;
                        const chartData = splitDramData[index] ?? EMPTY_CHART;

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
                                chartDataList={[chartData]}
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
            <div className='zoomed-dram-plots'>
                {dramDeltaObject.chartData.length > 0 && zoomedInViewMainMemory && splitDeltaData.length > 0 ? (
                    splitDeltaData.map((data, index) => {
                        const dramNonContinuousPlotZoomRangeStart = zoomedPlotSizes[index].min;
                        const dramNonContinuousPlotZoomRangeEnd = zoomedPlotSizes[index].max;
                        const chartData = data ?? EMPTY_CHART;

                        if (dramPlotZoomRangeEnd < dramPlotZoomRangeStart) {
                            dramPlotZoomRangeStart = 0;
                            dramPlotZoomRangeEnd = DRAM_MEMORY_SIZE;
                        }

                        return (
                            <MemoryPlotRenderer
                                key={index}
                                className={classNames('dram-memory-renderer', {
                                    'empty-plot': dramData.length === 0,
                                    'identical-plot': dramHasntChanged,
                                })}
                                style={{ flexBasis: calculateWidth(splitPreviousDramData)[index] }}
                                plotZoomRange={[dramNonContinuousPlotZoomRangeStart, dramNonContinuousPlotZoomRangeEnd]}
                                chartDataList={[chartData]}
                                isZoomedIn
                                memorySize={DRAM_MEMORY_SIZE}
                                onBufferClick={onDramDeltaClick}
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
                            'identical-plot': dramHasntChanged,
                        })}
                        plotZoomRange={[dramPlotZoomRangeStart, dramPlotZoomRangeEnd]}
                        chartDataList={[dramHasntChanged ? EMPTY_CHART : dramData]}
                        isZoomedIn={zoomedInViewMainMemory}
                        memorySize={DRAM_MEMORY_SIZE}
                        onBufferClick={onDramBufferClick}
                        configuration={DRAMRenderConfiguration}
                    />
                )}
            </div>

            <div
                className={classNames('legend', {
                    'lengthy-legend': dramMemoryReport.length > MAX_LEGEND_LENGTH,
                })}
            >
                {dramMemoryReport?.map((chunk, chunkIndex) => {
                    const group = groupedMemoryReport.get(chunk.address);

                    return Array.isArray(group) && group?.length > 1 ? (
                        <MemoryLegendGroup
                            group={group}
                            key={`${chunk.address}`}
                            memSize={DRAM_MEMORY_SIZE}
                            selectedTensorAddress={selectedAddress}
                            operationDetails={operationDetails}
                            onLegendClick={onLegendClick}
                        />
                    ) : (
                        <MemoryLegendElement
                            chunk={chunk}
                            key={`${chunk.address}-${chunkIndex}`}
                            memSize={DRAM_MEMORY_SIZE}
                            selectedTensorAddress={selectedAddress}
                            operationDetails={operationDetails}
                            onLegendClick={onLegendClick}
                        />
                    );
                })}
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
        const previousPoint = data?.[i - 1]?.memoryData;
        const thisPosition = (data?.[i]?.memoryData?.address ?? 0) as number;
        const previousPosition = previousPoint ? previousPoint.address + previousPoint.size : thisPosition;

        if (thisPosition - previousPosition > splitThreshold) {
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

interface MinMaxPlotSize {
    min: number;
    max: number;
}

const getZoomedPlotSizes = (
    previousData: Partial<PlotDataCustom>[][],
    currentData: Partial<PlotDataCustom>[][],
): MinMaxPlotSize[] => {
    const minMax: MinMaxPlotSize[] = [];
    const biggestDataSet = previousData.length > currentData.length ? previousData : currentData;

    biggestDataSet.forEach((dataArray) => {
        const minStartAddress = Math.min(
            dataArray[0]?.memoryData?.address || DRAM_MEMORY_SIZE * DRAM_PADDING_RATIO,
            dataArray.at(-1)?.memoryData?.address || DRAM_MEMORY_SIZE * DRAM_PADDING_RATIO,
        );

        const maxEndAddress = Math.max(
            (dataArray.at(-1)?.memoryData?.address ?? 0) +
                (dataArray.at(-1)?.memoryData?.size ?? 0) * (1 / DRAM_PADDING_RATIO) || 0,
            (dataArray[0]?.memoryData?.address ?? 0) +
                (dataArray[0]?.memoryData?.size ?? 0) * (1 / DRAM_PADDING_RATIO) || 0,
        );

        minMax.push({ min: minStartAddress, max: maxEndAddress });
    });

    return minMax;
};

const fillEmptySpaces = (zoomedPlotSizes: MinMaxPlotSize[], splitDataArray: Partial<PlotDataCustom>[][]) => {
    return zoomedPlotSizes.map((plotSize) => {
        const matchingIndex = splitDataArray.findIndex((data, index) => {
            const address = data[index]?.memoryData?.address;
            const size = data[index]?.memoryData?.size;

            if (!address || !size) {
                return false;
            }

            return data.length > 0 && address >= plotSize.min && address + size <= plotSize.max;
        });

        return matchingIndex !== -1 ? splitDataArray[matchingIndex] : [];
    });
};

export default DRAMPlots;
