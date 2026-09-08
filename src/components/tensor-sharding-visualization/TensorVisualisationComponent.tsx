// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo, useState } from 'react';
import { Button, ButtonVariant, Card, Overlay2, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { PlotData } from 'plotly.js';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { BufferType } from '../../model/BufferType';
import { useBufferChunks, useDevices } from '../../hooks/useAPI';
import 'styles/components/TensorVisualizationComponent.scss';
import { DecoratedBufferChunk, Tensor } from '../../model/APIData';
import SVGBufferRenderer from './SVGBufferRenderer';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import getChartData, { bufferChunksToColoredChunks } from '../../functions/getChartData';
import { L1RenderConfiguration } from '../../definitions/PlotConfigurations';
import MemoryPlotRenderer from '../operation-details/MemoryPlotRenderer';
import LoadingSpinner from '../LoadingSpinner';
import { showHexAtom } from '../../store/app';

export interface TensorVisualisationComponentProps {
    title: string;
    operationId: number;
    address?: number | string | undefined;
    bufferType?: BufferType;
    isOpen: boolean;
    onClose: () => void;
    tensorByAddress?: Map<number, Tensor>;
    tensorId?: number;
    plotZoomRange: [number, number];
}

const TensorVisualisationComponent = ({
    title,
    operationId,
    address,
    bufferType,
    isOpen,
    onClose,
    tensorByAddress,
    plotZoomRange,
    tensorId,
}: TensorVisualisationComponentProps) => {
    const { data } = useBufferChunks(operationId, address, bufferType);
    const { data: devices } = useDevices();
    const showHex = useAtomValue(showHexAtom);

    const [selectedTensix, setSelectedTensix] = useState<number | null>(null);
    const [chartData, setChartData] = useState<Partial<PlotData>[]>([]);

    // Project each cached BufferChunk into a DecoratedBufferChunk that
    // carries the resolved tensor association and the palette colour for
    // this render. Done off the React Query cache so the cached objects
    // stay untouched and a future second consumer of useBufferChunks can't
    // see fields populated by our `tensorByAddress` map. Computed in a
    // useMemo because both downstream readers (the per-bank grid and the
    // tensix-detail click handler) need the same shape, and the
    // address-keyed colour lookups are stable across re-renders.
    const { buffersByBankId, coordsByBankId } = useMemo(() => {
        const buckets: DecoratedBufferChunk[][] = [];
        const coords: { x: number; y: number }[] = [];
        if (!data) {
            return { buffersByBankId: buckets, coordsByBankId: coords };
        }
        for (const chunk of data) {
            // Match the original branching exactly: when `tensorByAddress` is
            // provided we use it (even if it doesn't contain the address —
            // the `tensorId` prop is then ignored); otherwise fall back to
            // the explicit `tensorId` prop, treating 0 / undefined as
            // "no association" the same way the legacy code did.
            const tensor = tensorByAddress?.get(chunk.address);
            const resolvedTensorId = tensorByAddress ? tensor?.id : tensorId || undefined;
            const tensorColor = resolvedTensorId !== undefined ? getTensorColor(resolvedTensorId) : undefined;
            // 'red' mirrors the SVGBufferRenderer's old `|| 'red'` fallback;
            // keeping it lets us narrow DecoratedBufferChunk.color to a
            // required string while preserving the pre-fix render.
            const color = tensorColor ?? getBufferColor(chunk.address) ?? 'red';
            const decorated: DecoratedBufferChunk = { ...chunk, tensor_id: resolvedTensorId, color };

            if (!buckets[chunk.bank_id]) {
                buckets[chunk.bank_id] = [];
            }
            buckets[chunk.bank_id].push(decorated);
            coords[chunk.bank_id] = { x: chunk.core_x, y: chunk.core_y };
        }
        return { buffersByBankId: buckets, coordsByBankId: coords };
    }, [data, tensorByAddress, tensorId]);

    if (!data || !devices) {
        return (
            <Overlay2
                isOpen={isOpen}
                enforceFocus
                hasBackdrop
                usePortal
                canEscapeKeyClose
                transitionDuration={0}
                onClose={onClose}
                canOutsideClickClose
                portalClassName='tensor-visualisation-overlay'
            >
                <Card className='loading-container'>
                    <LoadingSpinner />
                </Card>
            </Overlay2>
        );
    }

    if (devices.length === 0) {
        return null;
    }
    const width = devices[0].num_x_cores;
    const height = devices[0].num_y_cores;

    const [memStart, memEnd] = plotZoomRange;
    const tensixSize = 120;
    const tensixHeight = tensixSize / 3;

    return (
        <Overlay2
            isOpen={isOpen}
            enforceFocus
            hasBackdrop
            usePortal
            canEscapeKeyClose
            transitionDuration={0}
            onClose={onClose}
            canOutsideClickClose
            portalClassName='tensor-visualisation-overlay'
        >
            <Card className='tensor-visualisation'>
                <div className='header'>
                    <h3 className='title'>
                        {title}
                        <Button
                            icon={IconNames.CROSS}
                            variant={ButtonVariant.MINIMAL}
                            size={Size.SMALL}
                            onClick={onClose}
                        />
                    </h3>
                </div>

                <div className='chip'>
                    <div
                        className='tensix-grid'
                        style={{
                            gridTemplateColumns: `repeat(${width || 0}, 1fr)`,
                            gridTemplateRows: `repeat(${height || 0}, ${tensixHeight}px)`,
                        }}
                    >
                        {Array.from({ length: width * height }).map((_, index) => {
                            const x = index % width;
                            const y = Math.floor(index / width);
                            const matchIndex = coordsByBankId.findIndex((coord) => coord?.x === x && coord?.y === y);
                            const match = coordsByBankId[matchIndex];

                            return match ? (
                                <button
                                    type='button'
                                    key={index}
                                    className={classNames('tensix', {
                                        active: selectedTensix === matchIndex,
                                    })}
                                    style={{
                                        gridColumn: match.x + 1,
                                        gridRow: match.y + 1,
                                    }}
                                    onClick={() => {
                                        setSelectedTensix(matchIndex);
                                        setChartData(
                                            getChartData(
                                                bufferChunksToColoredChunks(buffersByBankId[matchIndex]),
                                                (id) => tensorByAddress?.get(id) || null,
                                                undefined,
                                                { showHex },
                                            ),
                                        );
                                    }}
                                >
                                    <SVGBufferRenderer
                                        height={tensixHeight}
                                        data={buffersByBankId[matchIndex]}
                                        memoryStart={memStart}
                                        memoryEnd={memEnd}
                                    />
                                </button>
                            ) : (
                                <div
                                    key={index}
                                    className='tensix empty-tensix'
                                    style={{
                                        gridColumn: x + 1,
                                        gridRow: y + 1,
                                    }}
                                />
                            );
                        })}
                    </div>
                </div>

                {selectedTensix !== null && (
                    <div className='tensix-details'>
                        <div className='tensix-details-header'>
                            <Button
                                icon={IconNames.CROSS}
                                variant={ButtonVariant.MINIMAL}
                                size={Size.SMALL}
                                onClick={() => {
                                    setSelectedTensix(null);
                                }}
                            />
                        </div>
                        <div className='tensix-details-content'>
                            <MemoryPlotRenderer
                                title={`Detailed L1 Report for ${coordsByBankId[selectedTensix].y}-${
                                    coordsByBankId[selectedTensix].x
                                }`}
                                className='detailed-l1-memory-renderer l1-memory-renderer'
                                isZoomedIn
                                plotZoomRange={[memStart, memEnd]}
                                chartDataList={[chartData]}
                                memoryZoomEnd={memEnd}
                                onBufferClick={() => {}}
                                configuration={{
                                    ...L1RenderConfiguration,
                                    title: `L1 address space for ${coordsByBankId[selectedTensix].y}-${coordsByBankId[selectedTensix].x}`,
                                }}
                            />
                        </div>
                    </div>
                )}
            </Card>
        </Overlay2>
    );
};

export default TensorVisualisationComponent;
