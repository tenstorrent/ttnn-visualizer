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

interface NPEViewProps {
    npeData: NPEData;
}

const NPEView: React.FC<NPEViewProps> = ({ npeData }) => {
    const tensixSize: number = NODE_SIZE; // * 0.75;
    const SVG_SIZE = tensixSize;
    const width = npeData.common_info.num_cols;
    const height = npeData.common_info.num_rows;
    const [, setSelectedTransfer] = React.useState<number | null>(null);
    const [selectedTimestep, setSelectedTimestep] = React.useState<number>(0);
    const links = npeData.timestep_data[selectedTimestep];
    const transfers = npeData.noc_transfers.filter((tr) => links?.active_transfers.includes(tr.id));
    const [animationInterval, setAnimationInterval] = React.useState<number | null>(null);
    const [selectedTransferList, setSelectedTransferList] = React.useState<NoCTransfer[]>([]);
    const [selectedIndex, setSelectedIndex] = React.useState<{ index: number; coords: number[] } | null>(null);
    const [isPlaying, setIsPlaying] = React.useState<boolean>(false);

    useEffect(() => {
        stopAnimation();
        setSelectedTimestep(863);
        setSelectedIndex(null);
        setSelectedTransferList([]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [npeData]);

    const getLines = (nocs: Array<{ transfer: number; nocId: NoCID | undefined }>) => {
        return nocs.map((noc) => {
            return getLinkPoints(noc.nocId!, getRouteColor(noc.transfer));
        });
    };
    // coords, [NoCID]
    const transferList = useMemo(() => {
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
        setSelectedIndex(null);
        setSelectedTransferList([]);
    };
    const showActiveTransfers = (route: [number, number, NoCID, number] | null, index?: number) => {
        if (route === null) {
            setSelectedTransferList([]);
            setSelectedIndex(null);
            return;
        }
        if (selectedIndex?.index === index) {
            setSelectedIndex(null);
            setSelectedTransferList([]);
            return;
        }
        if (index !== undefined) {
            setSelectedIndex({ index, coords: [route[0], route[1]] });
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
                                        <div style={{ position: 'absolute', right: 0 }}>&deg;</div>
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
                                key={`-${index}`}
                                className='tensix'
                                style={{
                                    ...(selectedTransferList.length !== 0 ? { opacity: 0.15 } : { opacity: 1 }),
                                    position: 'relative',
                                    gridColumn: route[1] + 1,
                                    gridRow: route[0] + 1,
                                }}
                                onClick={() => showActiveTransfers(route, index)}

                                // onMouseOut={() => showActiveTransfers(null)}
                            >
                                <TensixTransferRenderer
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
                            // top: '-5px',
                            // left: '-5px',
                            top: 0,
                            left: 0,
                            display: 'grid',
                            gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                        }}
                    >
                        {selectedTransferList.map((transfer, index) => (
                            <>
                                <div
                                    key={`-${index} src`}
                                    className='tensix no-click'
                                    style={{
                                        opacity: 0.75,
                                        border: '1px solid red',
                                        position: 'relative',
                                        // backgroundColor: getRouteColor(transfer.id),
                                        gridColumn: transfer.src[1] + 1,
                                        gridRow: transfer.src[0] + 1,
                                    }}
                                />
                                <div
                                    key={`-${index} dst`}
                                    className='tensix no-click'
                                    style={{
                                        opacity: 0.75,
                                        border: '1px solid blue',
                                        position: 'relative',
                                        // backgroundColor: getRouteColor(transfer.id),
                                        gridColumn: transfer.dst[1] + 1,
                                        gridRow: transfer.dst[0] + 1,
                                    }}
                                />
                            </>
                        ))}
                        {transferList.map((row, rowIndex) =>
                            row.map((transferForNoc, colIndex) => (
                                <div
                                    key={`-${rowIndex}-${colIndex}`}
                                    className={
                                        selectedIndex?.coords[0] === rowIndex && selectedIndex?.coords[1] === colIndex
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

                                            // background: 'rgba(255, 0, 0, 0.5)',
                                        }}
                                    >
                                        <TensixTransferRenderer
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
                </div>
                <div className='side-data'>
                    <div>
                        {selectedTransferList.length !== 0 && (
                            <>
                                <h3>Active transfers through {selectedIndex?.coords.join('-')}</h3>
                                <div>
                                    {selectedTransferList.map((transfer) => (
                                        <div
                                            key={transfer.id}
                                            style={{
                                                display: 'flex',
                                                gap: '5px',
                                                alignContent: 'center',
                                                alignItems: 'center',
                                                padding: '5px',
                                                margin: '5px',
                                            }}
                                            // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
                                            onMouseOver={() => setSelectedTransfer(transfer.id)}
                                            // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
                                            onMouseOut={() => setSelectedTransfer(null)}
                                        >
                                            <div
                                                style={{
                                                    //
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
                                            <div>bytes: {transfer.total_bytes}</div>
                                            <div>type: {transfer.noc_event_type}</div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NPEView;
