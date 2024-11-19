import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { PlotData } from 'plotly.js';
import { MemoryLegendElement } from './MemoryLegendElement';
import MemoryPlotRenderer from './MemoryPlotRenderer';
import { isEqual } from '../../functions/math';
import { DRAM_MEMORY_SIZE } from '../../definitions/DRAMMemorySize';
import { DRAMRenderConfiguration, MAX_LEGEND_LENGTH, PlotMouseEventCustom } from '../../definitions/PlotConfigurations';
import { FragmentationEntry } from '../../model/APIData';
import { BufferType } from '../../model/BufferType';
import { OperationDetails } from '../../model/OperationDetails';
import { selectedAddressAtom } from '../../store/app';

const DRAM_PADDING_RATIO = 0.9998;

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

    const splitDramData = (data: Partial<PlotData>[]) => {
        const result = [];
        let currentArray = [];

        for (let i = 0; i < data.length; i++) {
            const thisPosition = data?.[i]?.x?.[0] as number;
            const lastPosition = data?.[i - 1]?.x?.[0] as number;

            if (thisPosition - lastPosition > 10000000) {
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

    const getPlotConfig = () => ({
        nticks: 3,
    });

    return (
        <>
            <MemoryPlotRenderer
                title={`Previous Summarized DRAM Report ${dramHasntChanged ? ' (No changes)' : ''}  `}
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

            <h3 className='plot-title'>Current Plots</h3>

            <div className='current-dram-plots'>
                {splitDramData(dramData).map((data, index) => {
                    const start = data[0].x?.[0] as number;
                    const endPosition = data.at(-1)?.x?.[0] as number;
                    const endWidth = data.at(-1)?.width as number;

                    return (
                        <MemoryPlotRenderer
                            // eslint-disable-next-line react/no-array-index-key
                            key={index}
                            className={classNames('dram-memory-renderer', {
                                'empty-plot': dramData.length === 0,
                            })}
                            plotZoomRange={[start, endPosition - endWidth]}
                            chartDataList={[data]}
                            isZoomedIn
                            memorySize={DRAM_MEMORY_SIZE}
                            onBufferClick={onDramBufferClick}
                            configuration={{
                                ...DRAMRenderConfiguration,
                                ...getPlotConfig(),
                            }}
                        />
                    );
                })}
            </div>

            <MemoryPlotRenderer
                title='DRAM Delta (difference between current and previous operation)'
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
                {dramMemoryReport.map((chunk) => (
                    <MemoryLegendElement
                        chunk={chunk}
                        key={chunk.address}
                        memSize={DRAM_MEMORY_SIZE}
                        selectedTensorAddress={selectedAddress}
                        operationDetails={operationDetails}
                        onLegendClick={onLegendClick}
                    />
                ))}
            </div>
        </>
    );
}

export default DRAMPlots;
