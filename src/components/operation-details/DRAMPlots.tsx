import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { MemoryLegendElement } from './MemoryLegendElement';
import MemoryPlotRenderer from './MemoryPlotRenderer';
import { isEqual } from '../../functions/math';
import { DRAM_MEMORY_SIZE } from '../../definitions/DRAMMemorySize';
import { DRAMRenderConfiguration, PlotMouseEventCustom } from '../../definitions/PlotConfigurations';
import { FragmentationEntry } from '../../model/APIData';
import { BufferType } from '../../model/BufferType';
import { OperationDetails } from '../../model/OperationDetails';
import { selectedAddressAtom } from '../../store/app';

const DRAM_PADDING_RATIO = 0.9998;

interface DramPlotProps {
    details: OperationDetails;
    previousDetails: OperationDetails;
    zoomedInViewMainMemory: boolean;
    maxLegendLength: number;
    onDramBufferClick: (event: Readonly<PlotMouseEventCustom>) => void;
    onDramDeltaClick: (event: Readonly<PlotMouseEventCustom>) => void;
    onLegendClick: (address: number, tensorId?: number) => void;
}

function DRAMPlots({
    details,
    previousDetails,
    zoomedInViewMainMemory,
    maxLegendLength,
    onDramBufferClick,
    onDramDeltaClick,
    onLegendClick,
}: DramPlotProps) {
    const selectedAddress = useAtomValue(selectedAddressAtom);
    const { chartData: dramData, memory: dramMemory } = details.memoryData(BufferType.DRAM);
    const { chartData: previousDramData, memory: previousDramMemory } = previousDetails.memoryData(BufferType.DRAM);

    const dramHasntChanged = isEqual(dramMemory, previousDramMemory);

    const dramMemoryReport: FragmentationEntry[] = [...dramMemory].sort((a, b) => a.address - b.address);

    const dramDelta = dramMemoryReport.filter(
        (chunk) => !chunk.empty && !previousDramMemory.find((c) => c.address === chunk.address),
    );
    const reverseDramDelta = previousDramMemory.filter(
        (chunk) => !dramMemoryReport.find((c) => c.address === chunk.address),
    );
    const dramDeltaObject = details.getMemoryDelta(dramDelta, reverseDramDelta);

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

            <MemoryPlotRenderer
                title='Current Summarized DRAM Report'
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
                    'lengthy-legend': dramMemoryReport.length > maxLegendLength,
                })}
            >
                {dramMemoryReport.map((chunk) => (
                    <MemoryLegendElement
                        chunk={chunk}
                        key={chunk.address}
                        memSize={DRAM_MEMORY_SIZE}
                        selectedTensorAddress={selectedAddress}
                        operationDetails={details}
                        onLegendClick={onLegendClick}
                    />
                ))}
            </div>
        </>
    );
}

export default DRAMPlots;
