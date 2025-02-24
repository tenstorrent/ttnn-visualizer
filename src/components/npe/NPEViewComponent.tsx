// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
// @eslint-disable jsx-a11y/mouse-events-have-key-events

import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/NPEComponent.scss';
import React, { JSX, useEffect, useMemo, useState } from 'react';
import { Button, Slider } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { NPEData, NoCID, NoCTransfer } from '../../model/NPEModel';
import TensixTransferRenderer from './TensixTransferRenderer';
import { NODE_SIZE, calculateLinkCongestionColor, getLinkPoints, getRouteColor } from './drawingApi';
import NPECongestionHeatMap from './NPECongestionHeatMap';
import NPEMetadata from './NPEMetadata';
import ActiveTransferDetails from './ActiveTransferDetails';
import { useNodeType } from '../../hooks/useAPI';

interface NPEViewProps {
    npeData: NPEData;
}

const NPEView: React.FC<NPEViewProps> = ({ npeData }) => {
    const tensixSize: number = NODE_SIZE; // * 0.75;
    const SVG_SIZE = tensixSize;
    const width = npeData.common_info.num_cols;
    const height = npeData.common_info.num_rows;
    const [highlightedTransfer, setHighlightedTransfer] = useState<NoCTransfer | null>(null);
    const [selectedTimestep, setSelectedTimestep] = useState<number>(0);
    const links = npeData.timestep_data[selectedTimestep];
    const transfers = npeData.noc_transfers.filter((tr) => links?.active_transfers.includes(tr.id));
    const [animationInterval, setAnimationInterval] = useState<number | null>(null);
    const [selectedTransferList, setSelectedTransferList] = useState<NoCTransfer[]>([]);
    const [selectedNode, setSelectedNode] = useState<{ index: number; coords: number[] } | null>(null);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);

    const { cores, dram, eth, pcie } = useNodeType(npeData.common_info.device_name);
    const getNodeType = (location: number[]): JSX.Element => {
        const [y, x] = location;
        if (cores.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-c'>T</div>;
        }
        if (dram.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-d'>d</div>;
        }
        if (eth.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-e'>e</div>;
        }
        if (pcie.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-p'>p</div>;
        }
        return <div className='node-type-label' />;
    };

    useEffect(() => {
        stopAnimation();
        setSelectedTimestep(0);
        setSelectedNode(null);
        setSelectedTransferList([]);
        setHighlightedTransfer(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [npeData]);

    const getLines = (nocs: Array<{ transfer: number; nocId: NoCID }>) => {
        return nocs.map((noc) => {
            return getLinkPoints(noc.nocId, getRouteColor(noc.transfer));
        });
    };
    // coords, [NoCID]
    const transferListSelectionRendering = useMemo(() => {
        return selectedTransferList.reduce(
            (list: Array<Array<Array<{ transfer: number; nocId: NoCID }>>>, transfer) => {
                transfer.route.forEach(([row, col]) => {
                    list[row] = list[row] || [];
                    list[row][col] = list[row][col] || [];
                    const routes = transfer.route.filter((r) => r[0] === row && r[1] === col);
                    routes?.forEach((route) => {
                        list[row][col].push({
                            transfer: transfer.id,
                            nocId: route[2],
                        });
                    });
                });
                return list;
            },
            [],
        );
    }, [selectedTransferList]);

    const groupedTransfersByNoCID = useMemo<Record<NoCID, NoCTransfer[]>>(() => {
        if (!selectedNode?.coords) {
            return {} as Record<NoCID, NoCTransfer[]>;
        }

        const [targetRow, targetCol] = selectedNode.coords;
        const groups: Record<NoCID, NoCTransfer[]> = {} as Record<NoCID, NoCTransfer[]>;

        selectedTransferList.forEach((transfer) => {
            const matchingRoutes = transfer.route.filter(([row, col]) => row === targetRow && col === targetCol);

            if (matchingRoutes.length) {
                matchingRoutes.forEach((matchingRoute) => {
                    const nocId = matchingRoute[2];
                    if (!groups[nocId]) {
                        groups[nocId] = [];
                    }
                    groups[nocId].push(transfer);
                });
            }
        });

        return groups;
    }, [selectedTransferList, selectedNode]);

    const startAnimation = () => {
        setIsPlaying(true);
        clearInterval(animationInterval as number);
        const range = npeData.timestep_data.length;

        const interval = setInterval(() => {
            setSelectedTimestep((prev) => {
                return prev < range - 1 ? prev + 1 : 0;
            });
        }, 100);
        setAnimationInterval(interval as unknown as number);
    };
    const stopAnimation = () => {
        setIsPlaying(false);
        return clearInterval(animationInterval as number);
    };

    const onPlay = () => {
        startAnimation();
    };
    const onPause = () => {
        stopAnimation();
    };
    const handleScrubberChange = (value: number) => {
        stopAnimation();
        setSelectedTimestep(value);
        setSelectedNode(null);
        setSelectedTransferList([]);
    };
    const showActiveTransfers = (route: [number, number, NoCID, number] | null, index?: number) => {
        if (route === null) {
            setSelectedTransferList([]);
            setSelectedNode(null);
            return;
        }
        if (selectedNode?.index === index) {
            setSelectedNode(null);
            setSelectedTransferList([]);
            return;
        }
        if (index !== undefined) {
            setSelectedNode({ index, coords: [route[0], route[1]] });
        }

        onPause();

        const activeTransfers = npeData.timestep_data[selectedTimestep].active_transfers
            .map((transferId) => {
                const transfer = npeData.noc_transfers.find((tr) => tr.id === transferId);
                if (transfer) {
                    if (transfer.route.some((r) => r[0] === route[0] && r[1] === route[1])) {
                        return transfer;
                    }
                }
                return null;
            })
            .filter((tr) => tr !== null);
        setSelectedTransferList(activeTransfers as NoCTransfer[]);
    };

    const getOriginOpacity = (transfer: NoCTransfer): number => {
        if (highlightedTransfer !== null && highlightedTransfer.id === transfer.id) {
            return 1;
        }
        if (highlightedTransfer !== null) {
            return 0.15;
        }
        if (selectedTransferList.length === 0) {
            return 0; // 0.45;
        }
        const isSelected = selectedTransferList.some((t) => t.id === transfer.id);

        if (selectedTransferList.length !== 0 && !isSelected) {
            return 0.15;
        }

        return 1;
    };

    return (
        <div className='npe'>
            <NPEMetadata
                info={npeData.common_info}
                numTransfers={transfers.length}
            />
            <div className='header'>
                {!isPlaying && (
                    <Button
                        icon={IconNames.Play}
                        onClick={onPlay}
                    />
                )}
                {isPlaying && (
                    <Button
                        icon={IconNames.Pause}
                        onClick={onPause}
                    />
                )}
                <Slider
                    min={0}
                    max={npeData.timestep_data.length - 1}
                    stepSize={1}
                    labelStepSize={npeData.timestep_data.length > 20 ? npeData.timestep_data.length / 20 : 1}
                    value={selectedTimestep}
                    onChange={(value: number) => handleScrubberChange(value)}
                />
                <NPECongestionHeatMap timestepList={npeData.timestep_data} />
            </div>
            <div className='split-grid'>
                <div className='chip'>
                    <div
                        className='tensix-grid empty'
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                        }}
                    >
                        {Array.from({ length: width }).map((_, x) =>
                            Array.from({ length: height }).map((__, y) => (
                                // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
                                <div
                                    onClick={() => showActiveTransfers(null)}
                                    style={{
                                        gridColumn: x + 1,
                                        gridRow: y + 1,
                                        width: `${tensixSize}px`,
                                        height: `${tensixSize}px`,
                                        border: '1px solid black',
                                        position: 'relative',
                                    }}
                                    key={`${x}-${y}`}
                                >
                                    {getNodeType([y, x])}
                                </div>
                            )),
                        )}
                    </div>
                    <div
                        className='tensix-grid congestion'
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                        }}
                    >
                        {transfers.map((transfer) => (
                            <>
                                {transfer.src && (
                                    <div
                                        key={`${transfer.id}-src`}
                                        className='tensix src-dst src'
                                        style={{
                                            gridColumn: transfer.src[1] + 1,
                                            gridRow: transfer.src[0] + 1,
                                            opacity: getOriginOpacity(transfer),
                                        }}
                                    />
                                )}
                                {transfer.dst.map((dst) => {
                                    const classname = transfer.src?.toString() === dst.toString() ? 'both' : 'dst';
                                    return (
                                        <div
                                            key={`${transfer.id}-dst-${dst[0]}-${dst[1]}`}
                                            className={classNames('tensix src-dst', classname)}
                                            style={{
                                                gridColumn: dst[1] + 1,
                                                gridRow: dst[0] + 1,
                                                opacity: getOriginOpacity(transfer),
                                            }}
                                        />
                                    );
                                })}
                            </>
                        ))}

                        {links?.link_demand.map((route, index) => (
                            <button
                                type='button'
                                key={`${index}${route[0]}-${route[1]}`}
                                className='tensix'
                                style={{
                                    position: 'relative',
                                    gridColumn: route[1] + 1,
                                    gridRow: route[0] + 1,
                                }}
                                onClick={() => showActiveTransfers(route, index)}
                            >
                                {/* // TENSIX CONGESTION */}
                                <TensixTransferRenderer
                                    style={{
                                        opacity:
                                            highlightedTransfer !== null || selectedTransferList.length !== 0
                                                ? 0.15
                                                : 1,
                                    }}
                                    width={SVG_SIZE}
                                    height={SVG_SIZE}
                                    data={[getLinkPoints(route[2], calculateLinkCongestionColor(route[3]))]}
                                    isMulticolor={false}
                                />
                                <div style={{ fontSize: '9px', position: 'absolute', top: 0 }}>
                                    {route[0]}-{route[1]}
                                </div>
                            </button>
                        ))}
                    </div>
                    <div
                        className='tensix-grid transfers'
                        style={{
                            gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                        }}
                    >
                        {transferListSelectionRendering.map((row, rowIndex) =>
                            row.map((transfersForNoc, colIndex) => (
                                <div
                                    key={`selected-transfer-${rowIndex}-${colIndex}`}
                                    className={
                                        selectedNode?.coords[0] === rowIndex && selectedNode?.coords[1] === colIndex
                                            ? 'selected tensix no-click'
                                            : 'tensix no-click'
                                    }
                                    style={{
                                        gridColumn: colIndex + 1,
                                        gridRow: rowIndex + 1,
                                    }}
                                >
                                    <div className='transfer-render-ctn'>
                                        {/* TENSIX TRANSFERS */}
                                        <TensixTransferRenderer
                                            style={{
                                                ...(highlightedTransfer !== null ? { opacity: 0.25 } : { opacity: 1 }),
                                            }}
                                            width={SVG_SIZE}
                                            height={SVG_SIZE}
                                            data={getLines(transfersForNoc)}
                                            isMulticolor
                                        />
                                    </div>
                                </div>
                            )),
                        )}
                    </div>
                    {highlightedTransfer !== null && (
                        <div
                            className='tensix-grid transfer-single'
                            style={{
                                gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                                gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                            }}
                        >
                            {highlightedTransfer?.route.map((point) => (
                                <div
                                    key={`${point[0]}-${point[1]}-${point[2]}`}
                                    className='tensix'
                                    style={{
                                        position: 'relative',
                                        gridColumn: point[1] + 1,
                                        gridRow: point[0] + 1,
                                    }}
                                >
                                    <div className='transfer-render-ctn'>
                                        {/* HIGHLIGHTED TRANSFER */}
                                        <TensixTransferRenderer
                                            width={SVG_SIZE}
                                            height={SVG_SIZE}
                                            data={getLines([{ transfer: highlightedTransfer.id, nocId: point[2] }])}
                                            isMulticolor={false}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <ActiveTransferDetails
                    groupedTransfersByNoCID={groupedTransfersByNoCID}
                    selectedNode={selectedNode}
                    showActiveTransfers={showActiveTransfers}
                    highlightedTransfer={highlightedTransfer}
                    setHighlightedTransfer={setHighlightedTransfer}
                />
            </div>
        </div>
    );
};

export default NPEView;
