// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
// @eslint-disable jsx-a11y/mouse-events-have-key-events

import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/NPEComponent.scss';
import React, { JSX, useEffect, useMemo, useState } from 'react';
import { Button, ButtonGroup, Intent, Slider, Switch } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { LinkUtilization, NPEData, NPE_COORDINATES, NPE_LINK, NoCID, NoCTransfer } from '../../model/NPEModel';
import TensixTransferRenderer from './TensixTransferRenderer';
import { NODE_SIZE, calculateLinkCongestionColor, getLinkPoints, getRouteColor, resetRouteColors } from './drawingApi';
import NPECongestionHeatMap from './NPECongestionHeatMap';
import NPEMetadata from './NPEMetadata';
import ActiveTransferDetails from './ActiveTransferDetails';
import { useNodeType } from '../../hooks/useAPI';
import { DeviceArchitecture } from '../../definitions/DeviceArchitecture';

interface NPEViewProps {
    npeData: NPEData;
}

const LABEL_STEP_THRESHOLD = 25;
const RIGHT_MARGIN_OFFSET_PX = 25;
const TENSIX_SIZE: number = NODE_SIZE; // * 0.75;
const SVG_SIZE = TENSIX_SIZE;
const PLAYBACK_SPEED = 1;
const PLAYBACK_SPEED_2X = 2;

const NPEView: React.FC<NPEViewProps> = ({ npeData }) => {
    const width = npeData.common_info.num_cols;
    const height = npeData.common_info.num_rows;
    const [highlightedTransfer, setHighlightedTransfer] = useState<NoCTransfer | null>(null);
    const [selectedTimestep, setSelectedTimestep] = useState<number>(0);
    const links = npeData.timestep_data[selectedTimestep];
    const transfers = npeData.noc_transfers.filter((tr) => links?.active_transfers.includes(tr.id));
    const [animationInterval, setAnimationInterval] = useState<number | null>(null);
    const [selectedTransferList, setSelectedTransferList] = useState<NoCTransfer[]>([]);
    const [selectedNode, setSelectedNode] = useState<{ index: number; coords: NPE_COORDINATES } | null>(null);
    const [playbackSpeed, setPlaybackSpeed] = useState<number>(0);

    const [isShowingAllTransfers, setIsShowingAllTransfers] = useState<boolean>(false);

    const [canvasWidth, setCanvasWidth] = useState(window.innerWidth);
    useEffect(() => {
        const handleResize = () => setCanvasWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const { cores, dram, eth, pcie } = useNodeType(npeData.common_info.device_name as DeviceArchitecture);
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
        resetRouteColors();
        if (isShowingAllTransfers) {
            showAllTransfers();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTimestep, isShowingAllTransfers]);

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
                    const routes = transfer.route.filter((r) => r[NPE_LINK.Y] === row && r[NPE_LINK.X] === col);
                    routes?.forEach((route) => {
                        list[row][col].push({
                            transfer: transfer.id,
                            nocId: route[NPE_LINK.NOC_ID],
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

    const startAnimation = (speed: number = PLAYBACK_SPEED) => {
        setPlaybackSpeed(speed);
        clearInterval(animationInterval as number);
        const range = npeData.timestep_data.length;

        const interval = setInterval(() => {
            setSelectedTimestep((prev) => {
                return prev < range - 1 ? prev + 1 : 0;
            });
        }, 100 / speed);
        setAnimationInterval(interval as unknown as number);
    };
    const stopAnimation = () => {
        setPlaybackSpeed(0);
        return clearInterval(animationInterval as number);
    };

    const onPlay = () => {
        startAnimation();
    };
    const onPlay2x = () => {
        startAnimation(PLAYBACK_SPEED_2X);
    };
    const onPause = () => {
        stopAnimation();
    };
    const onBackward = () => {
        stopAnimation();
        const range = npeData.timestep_data.length;
        setSelectedNode(null);
        setSelectedTransferList([]);
        setSelectedTimestep((prev) => {
            return prev > 0 ? prev - 1 : range - 1;
        });
    };
    const onForward = () => {
        stopAnimation();
        setSelectedNode(null);
        setSelectedTransferList([]);
        const range = npeData.timestep_data.length;
        setSelectedTimestep((prev) => {
            return prev < range - 1 ? prev + 1 : 0;
        });
    };
    const handleScrubberChange = (value: number) => {
        stopAnimation();
        setSelectedTimestep(value);
        setSelectedNode(null);
        setSelectedTransferList([]);
    };
    const showActiveTransfers = (route: LinkUtilization | null, index?: number) => {
        hideAllTransfers();
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
            setSelectedNode({ index, coords: [route[NPE_LINK.Y], route[NPE_LINK.X]] });
        }

        onPause();

        const activeTransfers = npeData.timestep_data[selectedTimestep].active_transfers
            .map((transferId) => {
                const transfer = npeData.noc_transfers.find((tr) => tr.id === transferId);
                if (transfer) {
                    if (
                        transfer.route.some(
                            (r) => r[NPE_LINK.Y] === route[NPE_LINK.Y] && r[NPE_LINK.X] === route[NPE_LINK.X],
                        )
                    ) {
                        return transfer;
                    }
                }
                return null;
            })
            .filter((tr) => tr !== null);
        setSelectedTransferList(activeTransfers as NoCTransfer[]);
    };

    const hideAllTransfers = () => {
        setIsShowingAllTransfers(false);
        setSelectedTransferList([]);
    };

    const showAllTransfers = () => {
        setIsShowingAllTransfers(true);
        setSelectedNode(null);

        const activeTransfers = npeData.timestep_data[selectedTimestep].active_transfers
            .map((transferId) => npeData.noc_transfers.find((tr) => tr.id === transferId))
            .filter((transfer): transfer is NoCTransfer => transfer !== undefined);
        setSelectedTransferList(activeTransfers as NoCTransfer[]);
    };

    const getOriginOpacity = (transfer: NoCTransfer): number => {
        if (isShowingAllTransfers) {
            return 0;
        }
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

    const switchwidth = canvasWidth - canvasWidth / npeData.timestep_data.length - RIGHT_MARGIN_OFFSET_PX;
    return (
        <div className='npe'>
            <NPEMetadata
                info={npeData.common_info}
                numTransfers={transfers.length}
            />
            <div className='header'>
                <ButtonGroup className='npe-controls'>
                    <Button
                        icon={IconNames.StepBackward}
                        onClick={onBackward}
                    />
                    <Button
                        icon={IconNames.Play}
                        intent={playbackSpeed === PLAYBACK_SPEED ? Intent.PRIMARY : Intent.NONE}
                        onClick={onPlay}
                    />
                    <Button
                        icon={IconNames.FastForward}
                        onClick={onPlay2x}
                        intent={playbackSpeed === PLAYBACK_SPEED_2X ? Intent.PRIMARY : Intent.NONE}
                    />
                    <Button
                        icon={IconNames.STOP}
                        onClick={onPause}
                    />
                    <Button
                        icon={IconNames.StepForward}
                        onClick={onForward}
                    />
                    |
                    <Switch
                        label='Show all active transfers'
                        checked={isShowingAllTransfers}
                        onChange={() => (isShowingAllTransfers ? hideAllTransfers() : showAllTransfers())}
                    />
                </ButtonGroup>
                <div style={{ position: 'relative', width: `${switchwidth}px` }}>
                    <Slider
                        min={0}
                        max={npeData.timestep_data.length - 1}
                        stepSize={1}
                        labelStepSize={
                            npeData.timestep_data.length > LABEL_STEP_THRESHOLD ? npeData.timestep_data.length / 20 : 1
                        }
                        value={selectedTimestep}
                        onChange={(value: number) => handleScrubberChange(value)}
                    />
                    <div
                        className='bp5-slider-progress duplicate'
                        style={{ width: `${canvasWidth - RIGHT_MARGIN_OFFSET_PX}px` }}
                    />
                </div>
                <NPECongestionHeatMap
                    timestepList={npeData.timestep_data}
                    canvasWidth={canvasWidth}
                />
            </div>
            <div className='split-grid'>
                <div className='chip'>
                    <div
                        className='tensix-grid empty'
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${width || 0}, ${TENSIX_SIZE}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${TENSIX_SIZE}px)`,
                        }}
                    >
                        {Array.from({ length: width }).map((_, x) =>
                            Array.from({ length: height }).map((__, y) => (
                                // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
                                <div
                                    className='tensix empty-tensix'
                                    onClick={() => showActiveTransfers(null)}
                                    style={{
                                        gridColumn: x + 1,
                                        gridRow: y + 1,
                                        width: `${TENSIX_SIZE}px`,
                                        height: `${TENSIX_SIZE}px`,
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
                            gridTemplateColumns: `repeat(${width || 0}, ${TENSIX_SIZE}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${TENSIX_SIZE}px)`,
                        }}
                    >
                        {transfers.map((transfer, index) => (
                            <>
                                {transfer.src && (
                                    <div
                                        key={`${transfer.id}-src-${index}`}
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
                                            key={`${transfer.id}-dst-${index}-${dst[0]}-${dst[1]}`}
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
                                key={`${index}-${route[NPE_LINK.Y]}-${route[NPE_LINK.X]}-${route[NPE_LINK.NOC_ID]}`}
                                className='tensix'
                                style={{
                                    position: 'relative',
                                    gridColumn: route[NPE_LINK.X] + 1,
                                    gridRow: route[NPE_LINK.Y] + 1,
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
                                    data={[
                                        getLinkPoints(route[2], calculateLinkCongestionColor(route[NPE_LINK.DEMAND])),
                                    ]}
                                    isMulticolor={false}
                                />
                                <div style={{ fontSize: '9px', position: 'absolute', top: 0 }}>
                                    {route[NPE_LINK.Y]}-{route[NPE_LINK.X]}
                                </div>
                            </button>
                        ))}
                    </div>
                    <div
                        className='tensix-grid transfers'
                        style={{
                            gridTemplateColumns: `repeat(${width || 0}, ${TENSIX_SIZE}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${TENSIX_SIZE}px)`,
                        }}
                    >
                        {transferListSelectionRendering.map((row, rowIndex) =>
                            row.map((transfersForNoc, colIndex) => (
                                <div
                                    key={`selected-transfer-${rowIndex}-${colIndex}`}
                                    className={
                                        selectedNode?.coords[NPE_LINK.Y] === rowIndex &&
                                        selectedNode?.coords[NPE_LINK.X] === colIndex
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
                                gridTemplateColumns: `repeat(${width || 0}, ${TENSIX_SIZE}px)`,
                                gridTemplateRows: `repeat(${height || 0}, ${TENSIX_SIZE}px)`,
                            }}
                        >
                            {highlightedTransfer?.route.map((point) => (
                                <div
                                    key={`${point[NPE_LINK.Y]}-${point[NPE_LINK.X]}-${point[NPE_LINK.NOC_ID]}`}
                                    className='tensix'
                                    style={{
                                        position: 'relative',
                                        gridColumn: point[NPE_LINK.X] + 1,
                                        gridRow: point[NPE_LINK.Y] + 1,
                                    }}
                                >
                                    <div className='transfer-render-ctn'>
                                        {/* HIGHLIGHTED TRANSFER */}
                                        <TensixTransferRenderer
                                            width={SVG_SIZE}
                                            height={SVG_SIZE}
                                            data={getLines([
                                                { transfer: highlightedTransfer.id, nocId: point[NPE_LINK.NOC_ID] },
                                            ])}
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
                    congestionData={links?.link_demand.filter(
                        (route) =>
                            route[NPE_LINK.Y] === selectedNode?.coords[NPE_LINK.Y] &&
                            route[NPE_LINK.X] === selectedNode?.coords[NPE_LINK.X],
                    )}
                    showActiveTransfers={showActiveTransfers}
                    highlightedTransfer={highlightedTransfer}
                    setHighlightedTransfer={setHighlightedTransfer}
                />
            </div>
        </div>
    );
};

export default NPEView;
