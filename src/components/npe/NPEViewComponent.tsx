// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
// @eslint-disable jsx-a11y/mouse-events-have-key-events

import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/NPEComponent.scss';
import React, { useEffect, useMemo } from 'react';
import { Button, Slider } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { NPEData, NoCID, NoCTransfer } from '../../model/NPEModel';
import TensixTransferRenderer from './TensixTransferRenderer';
import { NODE_SIZE, calculateLinkCongestionColor, getLinkPoints, getRouteColor } from './drawingApi';
import NPECongestionHeatMap from './NPECongestionHeatMap';
import { formatSize } from '../../functions/math';

interface NPEViewProps {
    npeData: NPEData;
}

const NPEView: React.FC<NPEViewProps> = ({ npeData }) => {
    const tensixSize: number = NODE_SIZE; // * 0.75;
    const SVG_SIZE = tensixSize;
    const width = npeData.common_info.num_cols;
    const height = npeData.common_info.num_rows;
    const [highlightedTransfer, setHighlightedTransfer] = React.useState<NoCTransfer | null>(null);
    const [selectedTimestep, setSelectedTimestep] = React.useState<number>(0);
    const links = npeData.timestep_data[selectedTimestep];
    const transfers = npeData.noc_transfers.filter((tr) => links?.active_transfers.includes(tr.id));
    const [animationInterval, setAnimationInterval] = React.useState<number | null>(null);
    const [selectedTransferList, setSelectedTransferList] = React.useState<NoCTransfer[]>([]);
    const [selectedNode, setSelectedNode] = React.useState<{ index: number; coords: number[] } | null>(null);
    const [isPlaying, setIsPlaying] = React.useState<boolean>(false);

    useEffect(() => {
        stopAnimation();
        setSelectedTimestep(0);
        setSelectedNode(null);
        setSelectedTransferList([]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [npeData]);

    const getLines = (nocs: Array<{ transfer: number; nocId: NoCID | undefined }>) => {
        return nocs.map((noc) => {
            return getLinkPoints(noc.nocId!, getRouteColor(noc.transfer));
        });
    };
    // coords, [NoCID]
    const transferListSelectionRendering = useMemo(() => {
        return selectedTransferList.reduce(
            (list: Array<Array<Array<{ transfer: number; nocId: NoCID | undefined }>>>, transfer) => {
                transfer.route.forEach(([row, col]) => {
                    list[row] = list[row] || [];
                    list[row][col] = list[row][col] || [];
                    list[row][col].push({
                        transfer: transfer.id,
                        nocId: transfer.route.find((r) => r[0] === row && r[1] === col)?.[2],
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

        return selectedTransferList.reduce(
            (acc, transfer) => {
                const matchingRoute = transfer.route.find(([row, col]) => row === targetRow && col === targetCol);
                if (!matchingRoute) {
                    return acc;
                }
                const nocId = matchingRoute[2];

                if (!acc[nocId]) {
                    acc[nocId] = [];
                }
                acc[nocId].push(transfer);
                return acc;
            },
            {} as Record<NoCID, NoCTransfer[]>,
        );
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

    return (
        <div className='npe'>
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
                    labelStepSize={25}
                    value={selectedTimestep}
                    onChange={(value: number) => handleScrubberChange(value)}
                />
                <NPECongestionHeatMap timestepList={npeData.timestep_data} />
            </div>
            <div
                className='split-grid'
                style={{ display: 'flex' }}
            >
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
                                    }}
                                    key={`${x}-${y}`}
                                />
                            )),
                        )}
                    </div>
                    <div
                        className='tensix-grid'
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                        }}
                    >
                        {transfers.map((transfer) => (
                            <>
                                {transfer?.src && (
                                    <div
                                        key={`${transfer.id}-src`}
                                        className='tensix'
                                        style={{
                                            position: 'relative',
                                            gridColumn: transfer.src[1] + 1,
                                            gridRow: transfer.src[0] + 1,
                                            color: 'red',
                                        }}
                                    >
                                        <div style={{ position: 'absolute', right: '4px' }}>&deg;</div>
                                    </div>
                                )}
                                {transfer?.dst && (
                                    <div
                                        className='tensix'
                                        key={`${transfer.id}-dst`}
                                        style={{
                                            position: 'relative',
                                            gridColumn: transfer.dst[1] + 1,
                                            gridRow: transfer.dst[0] + 1,
                                            color: 'blue',
                                        }}
                                    >
                                        <div style={{ position: 'absolute', right: 0 }}>&deg;</div>
                                    </div>
                                )}
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
                                <TensixTransferRenderer
                                    style={{
                                        ...(selectedTransferList.length !== 0 ? { opacity: 0.15 } : { opacity: 1 }),
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
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            display: 'grid',
                            gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                        }}
                    >
                        {transferListSelectionRendering.map((row, rowIndex) =>
                            row.map((transferForNoc, colIndex) => (
                                <div
                                    key={`${rowIndex}-${colIndex}`}
                                    className={
                                        selectedNode?.coords[0] === rowIndex && selectedNode?.coords[1] === colIndex
                                            ? 'selected tensix no-click'
                                            : 'tensix no-click'
                                    }
                                    style={{
                                        position: 'relative',
                                        gridColumn: colIndex + 1,
                                        gridRow: rowIndex + 1,
                                    }}
                                >
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: '100%',
                                        }}
                                    >
                                        <TensixTransferRenderer
                                            style={{
                                                ...(highlightedTransfer !== null ? { opacity: 0.25 } : { opacity: 1 }),
                                            }}
                                            width={SVG_SIZE}
                                            height={SVG_SIZE}
                                            data={getLines(transferForNoc)}
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
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                display: 'grid',
                                gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                                gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                                // backgroundColor: 'rgba(0, 0, 0, 0.75)',
                                zIndex: 1,
                            }}
                        >
                            {highlightedTransfer?.route.map((point) => (
                                <div
                                    key={`${point[0]}-${point[1]}`}
                                    className='tensix'
                                    style={{
                                        position: 'relative',
                                        gridColumn: point[1] + 1,
                                        gridRow: point[0] + 1,
                                    }}
                                >
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: '100%',
                                        }}
                                    >
                                        <TensixTransferRenderer
                                            width={SVG_SIZE}
                                            height={SVG_SIZE}
                                            data={getLines([{ transfer: highlightedTransfer.id, nocId: point[2] }])}
                                            // data={getLinkPoints([{ transfer: highlightedTransfer.id, nocId: point[2] }])}

                                            isMulticolor={false}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className='side-data'>
                    <div>
                        {Object.keys(groupedTransfersByNoCID).length !== 0 && (
                            <>
                                <h3 style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    Active transfers through {selectedNode?.coords.join('-')}
                                    <Button
                                        minimal
                                        icon={IconNames.CROSS}
                                        onClick={() => setSelectedNode(null)}
                                    />
                                </h3>
                                {Object.entries(groupedTransfersByNoCID).map(([nocId, localTransferList]) => (
                                    <div
                                        key={nocId}
                                        style={{ marginBottom: '20px' }}
                                    >
                                        <h4>NOC ID: {nocId}</h4>
                                        {localTransferList.map((transfer) => (
                                            <div
                                                key={transfer.id}
                                                style={{
                                                    display: 'flex',
                                                    gap: '5px',
                                                    alignContent: 'center',
                                                    alignItems: 'center',
                                                    padding: '5px',
                                                    margin: '5px',
                                                    transition: 'opacity 0.2s',
                                                    cursor: 'pointer',
                                                    opacity:
                                                        highlightedTransfer == null || highlightedTransfer === transfer
                                                            ? 1
                                                            : 0.25,
                                                }}
                                                // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
                                                onMouseOver={() => setHighlightedTransfer(transfer)}
                                                // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
                                                onMouseOut={() => setHighlightedTransfer(null)}
                                            >
                                                <div
                                                    style={{
                                                        backgroundColor: getRouteColor(transfer.id),
                                                        width: '10px',
                                                        height: '10px',
                                                    }}
                                                />
                                                {transfer.id}
                                                <div>
                                                    <span style={{ border: '1px solid red' }}>
                                                        {transfer.src.join('-')}
                                                    </span>{' '}
                                                    -&gt;
                                                    <span style={{ border: '1px solid blue' }}>
                                                        {transfer.dst.join('-')}
                                                    </span>
                                                </div>
                                                <div>{formatSize(transfer.total_bytes)}B</div>
                                                <div>{transfer.noc_event_type}</div>
                                                <div>injection rate: {transfer.injection_rate.toFixed(2)}</div>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NPEView;
