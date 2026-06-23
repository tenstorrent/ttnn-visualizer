// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonGroup, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import 'styles/components/ClusterView.scss';
import { stringToArchitecture } from '../../definitions/DeviceArchitecture';
import { useArchitecture, useGetClusterDescription } from '../../hooks/useAPI';
import {
    CLUSTER_COORDS,
    CLUSTER_ETH_POSITION,
    ChipDesign,
    ClusterChip,
    ClusterCoordinates,
    ClusterModel,
    DEFAULT_ARCHITECTURE,
} from '../../model/ClusterModel';
import {
    CHIP_GAP,
    CHIP_PADDING,
    CLUSTER_NODE_GRID_SIZE,
    ZOOM_MAX,
    ZOOM_MIN,
    ZOOM_PIXEL_SCALE,
    ZOOM_STEP,
    calculatePciePixelPosition,
    clampZoom,
} from '../../functions/clusterPositioning';

const CLUSTER_CHIP_SIZE_LARGE = 350;
const CLUSTER_CHIP_SIZE_MEDIUM = 250;
const CLUSTER_CHIP_SIZE_SMALL = 150;

interface PortPixel {
    x: number;
    y: number;
}

interface LinkSegment {
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    chipA: number;
    chipB: number;
}

interface ClusterTopology {
    chips: ClusterChip[];
    chipsById: Map<number, ClusterChip>;
    neighboursByChip: Map<number, Set<number>>;
    clusterChipSize: number;
    totalCols: number;
    totalRows: number;
    contentWidth: number;
    contentHeight: number;
    ethPositionsByChip: Map<number, Map<CLUSTER_ETH_POSITION, string[]>>;
    linkSegments: LinkSegment[];
    idFontSize: number;
}

type ClusterTopologyResult = { status: 'ready'; topology: ClusterTopology } | { status: 'unsupported' };

const getEthGridPosition = (ethPosition: CLUSTER_ETH_POSITION, index: number) => {
    let x = 0;
    let y = 0;
    switch (ethPosition) {
        case CLUSTER_ETH_POSITION.TOP:
            x = index + 2;
            y = 1;
            break;
        case CLUSTER_ETH_POSITION.BOTTOM:
            x = index + 2;
            y = CLUSTER_NODE_GRID_SIZE;
            break;
        case CLUSTER_ETH_POSITION.LEFT:
            x = 1;
            y = index + 2;
            break;
        case CLUSTER_ETH_POSITION.RIGHT:
            x = CLUSTER_NODE_GRID_SIZE;
            y = index + 2;
            break;
        default:
            return { x, y };
    }
    return { x, y };
};

function buildClusterTopology(data: ClusterModel, chipDesign: ChipDesign): ClusterTopologyResult {
    const mmioChips = data.chips_with_mmio.map((obj) => {
        return Object.values(obj)[0];
    });

    const connections = data.ethernet_connections;
    let chipsObject = data.chips;
    if ((!chipsObject || Object.keys(chipsObject).length === 0) && mmioChips.length) {
        if (mmioChips.length <= 2) {
            chipsObject = mmioChips.reduce(
                (acc, chipId: number, index: number) => {
                    acc[chipId] = [index, 0, 0, 0];
                    return acc;
                },
                {} as { [p: number]: ClusterCoordinates },
            );
        } else {
            return { status: 'unsupported' };
        }
    }

    let totalCols = 0;
    let totalRows = 0;

    const chips = Object.entries(chipsObject).map(([ClusterChipId, coords]) => {
        const chipId = parseInt(ClusterChipId, 10);
        totalCols = Math.max(totalCols, coords[CLUSTER_COORDS.X] + 1);
        totalRows = Math.max(totalRows, coords[CLUSTER_COORDS.Y] + 1);

        const chip: ClusterChip = {
            id: chipId,
            coords,
            mmio: mmioChips.includes(chipId),
            connectedChipsByEthId: new Map(),
            eth: chipDesign.eth.map((coreId) => `${ClusterChipId}-${coreId}`),
        };

        chip.design = chipDesign;
        return chip;
    });

    const chipsById = new Map<number, ClusterChip>(chips.map((chip) => [chip.id, chip]));

    let clusterChipSize = CLUSTER_CHIP_SIZE_LARGE;
    if (chips.length >= 8) {
        clusterChipSize = CLUSTER_CHIP_SIZE_MEDIUM;
    }
    if (chips.length >= 32) {
        clusterChipSize = CLUSTER_CHIP_SIZE_SMALL;
    }

    connections.forEach((connection) => {
        const chip0 = chipsById.get(connection[0].chip);
        const chip1 = chipsById.get(connection[1].chip);
        if (!chip0 || !chip1) {
            return;
        }
        const uid0 = chip0.eth[connection[0].chan];
        const uid1 = chip1.eth[connection[1].chan];
        // Skip connection if either UID is undefined to prevent silently storing
        // under empty-string keys, which would be lost on later lookups.
        if (uid0 !== undefined && uid1 !== undefined) {
            chip0.connectedChipsByEthId.set(uid0, chip1);
            chip1.connectedChipsByEthId.set(uid1, chip0);
        }
    });

    const neighboursByChip = new Map<number, Set<number>>();
    connections.forEach((connection) => {
        const a = connection[0].chip;
        const b = connection[1].chip;
        if (!chipsById.has(a) || !chipsById.has(b)) {
            return;
        }
        if (!neighboursByChip.has(a)) {
            neighboursByChip.set(a, new Set());
        }
        if (!neighboursByChip.has(b)) {
            neighboursByChip.set(b, new Set());
        }
        neighboursByChip.get(a)?.add(b);
        neighboursByChip.get(b)?.add(a);
    });

    const stride = clusterChipSize + CHIP_GAP;
    const contentWidth = totalCols * clusterChipSize + Math.max(0, totalCols - 1) * CHIP_GAP;
    const contentHeight = totalRows * clusterChipSize + Math.max(0, totalRows - 1) * CHIP_GAP;

    const internalGap = CHIP_GAP;
    const cellSize =
        (clusterChipSize - CHIP_PADDING * 2 - (CLUSTER_NODE_GRID_SIZE - 1) * internalGap) / CLUSTER_NODE_GRID_SIZE;
    const portPixel = (coords: ClusterCoordinates, gx: number, gy: number): PortPixel => {
        const chipLeft = coords[CLUSTER_COORDS.X] * stride + CHIP_PADDING;
        const chipTop = coords[CLUSTER_COORDS.Y] * stride + CHIP_PADDING;
        return {
            x: chipLeft + (gx - 1) * (cellSize + internalGap) + cellSize / 2,
            y: chipTop + (gy - 1) * (cellSize + internalGap) + cellSize / 2,
        };
    };

    const ethPositionsByChip = new Map<number, Map<CLUSTER_ETH_POSITION, string[]>>();
    const portPixelByUid = new Map<string, PortPixel>();

    chips.forEach((clusterChip) => {
        const ethPosition = new Map<CLUSTER_ETH_POSITION, string[]>();

        clusterChip.design?.eth.forEach((coreId) => {
            const uid = `${clusterChip.id}-${coreId}`;
            const connectedChip = clusterChip.connectedChipsByEthId.get(uid);
            let position: CLUSTER_ETH_POSITION | null = null;
            if (connectedChip) {
                if (connectedChip.coords[CLUSTER_COORDS.X] < clusterChip.coords[CLUSTER_COORDS.X]) {
                    position = CLUSTER_ETH_POSITION.LEFT;
                }
                if (connectedChip.coords[CLUSTER_COORDS.X] > clusterChip.coords[CLUSTER_COORDS.X]) {
                    position = CLUSTER_ETH_POSITION.RIGHT;
                }
                if (connectedChip.coords[CLUSTER_COORDS.Y] < clusterChip.coords[CLUSTER_COORDS.Y]) {
                    position = CLUSTER_ETH_POSITION.TOP;
                }
                if (connectedChip.coords[CLUSTER_COORDS.Y] > clusterChip.coords[CLUSTER_COORDS.Y]) {
                    position = CLUSTER_ETH_POSITION.BOTTOM;
                }
            }
            if (position) {
                if (ethPosition.has(position)) {
                    ethPosition.get(position)?.push(uid);
                } else {
                    ethPosition.set(position, [uid]);
                }
            }
        });

        ethPosition.forEach((uids, position) => {
            uids.forEach((uid, index) => {
                const { x, y } = getEthGridPosition(position, index);
                portPixelByUid.set(uid, portPixel(clusterChip.coords, x, y));
            });
        });

        ethPositionsByChip.set(clusterChip.id, ethPosition);
    });

    const linkSegments: LinkSegment[] = [];
    connections.forEach((connection, connectionIndex) => {
        const chipA = chipsById.get(connection[0].chip);
        const chipB = chipsById.get(connection[1].chip);
        if (!chipA || !chipB) {
            return;
        }
        const uidA = chipA.eth[connection[0].chan];
        const uidB = chipB.eth[connection[1].chan];
        const portA = uidA ? portPixelByUid.get(uidA) : undefined;
        const portB = uidB ? portPixelByUid.get(uidB) : undefined;
        if (!portA || !portB) {
            return;
        }
        linkSegments.push({
            key: `${uidA}__${uidB}__${connectionIndex}`,
            x1: portA.x,
            y1: portA.y,
            x2: portB.x,
            y2: portB.y,
            chipA: chipA.id,
            chipB: chipB.id,
        });
    });

    const idFontSize = clusterChipSize >= CLUSTER_CHIP_SIZE_MEDIUM ? 30 : 20;

    return {
        status: 'ready',
        topology: {
            chips,
            chipsById,
            neighboursByChip,
            clusterChipSize,
            totalCols,
            totalRows,
            contentWidth,
            contentHeight,
            ethPositionsByChip,
            linkSegments,
            idFontSize,
        },
    };
}

function ClusterRenderer() {
    const navigate = useNavigate();
    const { data } = useGetClusterDescription();

    // `userZoom === null` means "auto-fit to the available space"; any number is an
    // explicit zoom the user has dialled in.
    const [userZoom, setUserZoom] = useState<number | null>(null);
    const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
    const [hoveredChip, setHoveredChip] = useState<number | null>(null);

    // we don't support mixed architecture for now
    // we will default to wormhole
    const arch = stringToArchitecture((data?.arch.length && data.arch[0]) || DEFAULT_ARCHITECTURE);
    const chipDesign = useArchitecture(arch);

    const topologyResult = useMemo(() => {
        if (!data) {
            return null;
        }
        return buildClusterTopology(data, chipDesign);
    }, [data, chipDesign]);

    // close the topology overlay when Escape is pressed
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                navigate(-1);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [navigate]);

    // observe the scroll container so we can fit the topology to its size
    const observerRef = useRef<ResizeObserver | null>(null);
    const wrapNodeRef = useRef<HTMLDivElement | null>(null);
    const fitZoomRef = useRef(1);

    // ctrl/⌘ + wheel zooms the topology. This must be a native, non-passive listener:
    // React attaches `wheel` to the root as a passive listener, so `preventDefault()`
    // inside an `onWheel` prop is ignored and the browser zooms the whole page instead.
    const handleWheelNative = useCallback((event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) {
            return; // let the container scroll/pan normally
        }
        event.preventDefault();
        // Pixel-mode events come from trackpad/pinch and have small per-frame deltaY
        // values. Scale them proportionally so the gesture feels natural instead of
        // jumping by a fixed step on every frame. Line-mode events (mouse wheel) keep
        // the fixed step.
        const step =
            event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
                ? Math.min(Math.abs(event.deltaY) * ZOOM_PIXEL_SCALE, ZOOM_STEP)
                : ZOOM_STEP;
        const direction = event.deltaY > 0 ? -1 : 1;
        setUserZoom((prevZoom) => clampZoom((prevZoom ?? fitZoomRef.current) + direction * step));
    }, []);

    const setWrapRef = useCallback(
        (node: HTMLDivElement | null) => {
            observerRef.current?.disconnect();
            wrapNodeRef.current?.removeEventListener('wheel', handleWheelNative);
            wrapNodeRef.current = node;
            if (node) {
                const observer = new ResizeObserver((entries) => {
                    const entry = entries[0];
                    if (entry) {
                        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
                    }
                });
                observer.observe(node);
                observerRef.current = observer;
                node.addEventListener('wheel', handleWheelNative, { passive: false });
            }
        },
        [handleWheelNative],
    );

    const topology = topologyResult?.status === 'ready' ? topologyResult.topology : null;

    const fitZoom =
        containerSize && topology
            ? Math.max(
                  ZOOM_MIN,
                  Math.min(
                      containerSize.width / topology.contentWidth,
                      containerSize.height / topology.contentHeight,
                      1,
                  ),
              )
            : 1;
    const zoom = userZoom ?? fitZoom;

    // keep the native wheel handler's fit-zoom up to date without re-registering it.
    useEffect(() => {
        fitZoomRef.current = fitZoom;
    }, [fitZoom]);

    const closeButton = (
        <div className='cluster-view-header'>
            <Button
                icon={IconNames.CROSS}
                onClick={() => {
                    navigate(-1);
                }}
                aria-label='Close cluster view'
            />
        </div>
    );

    if (!data) {
        return (
            <div className='cluster-view-renderer'>
                {closeButton}
                <div className='cluster-view-wrap'>
                    <p>Loading...</p>
                </div>
            </div>
        );
    }

    if (topologyResult?.status === 'unsupported') {
        return (
            <div className='cluster-view-renderer'>
                {closeButton}
                <div className='cluster-view-wrap'>
                    <p>
                        Topology rendering is not supported for your current setup. This will be supported in future
                        releases
                    </p>
                </div>
            </div>
        );
    }

    if (topologyResult?.status !== 'ready') {
        return (
            <div className='cluster-view-renderer'>
                {closeButton}
                <div className='cluster-view-wrap'>
                    <p>Loading...</p>
                </div>
            </div>
        );
    }

    const {
        chips,
        neighboursByChip,
        clusterChipSize,
        totalCols,
        totalRows,
        contentWidth,
        contentHeight,
        ethPositionsByChip,
        linkSegments,
        idFontSize,
    } = topologyResult.topology;

    const isChipActive = (chipId: number) => {
        if (hoveredChip === null) {
            return true;
        }
        return chipId === hoveredChip || !!neighboursByChip.get(hoveredChip)?.has(chipId);
    };

    const header = (
        <div className='cluster-view-header'>
            <ButtonGroup className='cluster-view-zoom'>
                <Tooltip content='Zoom out'>
                    <Button
                        icon={IconNames.ZOOM_OUT}
                        onClick={() => setUserZoom(clampZoom(zoom - ZOOM_STEP))}
                        disabled={zoom <= ZOOM_MIN}
                        aria-label='Zoom out'
                    />
                </Tooltip>
                <Tooltip content='Fit to screen'>
                    <Button
                        className='zoom-percentage-button'
                        text={`${Math.round(zoom * 100)}%`}
                        onClick={() => setUserZoom(null)}
                        aria-label='Fit topology to screen'
                    />
                </Tooltip>
                <Tooltip content='Zoom in'>
                    <Button
                        icon={IconNames.ZOOM_IN}
                        onClick={() => setUserZoom(clampZoom(zoom + ZOOM_STEP))}
                        disabled={zoom >= ZOOM_MAX}
                        aria-label='Zoom in'
                    />
                </Tooltip>
            </ButtonGroup>
            <Button
                icon={IconNames.CROSS}
                onClick={() => {
                    navigate(-1);
                }}
                aria-label='Close cluster view'
            />
        </div>
    );

    const dimmed = hoveredChip !== null;

    return (
        <div className='cluster-view-renderer'>
            {header}

            <div className='cluster-legend'>
                <span className='legend-item'>
                    <span className='legend-swatch swatch-chip' /> Device
                </span>
                <span className='legend-item'>
                    <span className='legend-swatch swatch-mmio' /> PCIe / host-connected
                </span>
                <span className='legend-item'>
                    <span className='legend-swatch swatch-eth' /> Ethernet port
                </span>
                <span className='legend-item'>
                    <span className='legend-line' /> Ethernet link
                </span>
            </div>

            <div
                className='cluster-view-wrap'
                ref={setWrapRef}
            >
                <div
                    className='cluster-stage'
                    style={{
                        width: `${contentWidth * zoom}px`,
                        height: `${contentHeight * zoom}px`,
                    }}
                >
                    <div
                        className={classNames('cluster', { 'is-dimmed': dimmed })}
                        style={{
                            width: `${contentWidth}px`,
                            height: `${contentHeight}px`,
                            transform: `scale(${zoom})`,
                            transformOrigin: 'top left',
                            gap: `${CHIP_GAP}px`,
                            gridTemplateColumns: `repeat(${totalCols || 0}, ${clusterChipSize}px)`,
                            gridTemplateRows: `repeat(${totalRows || 0}, ${clusterChipSize}px)`,
                        }}
                        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                        tabIndex={0}
                    >
                        <svg
                            className='cluster-links'
                            width={contentWidth}
                            height={contentHeight}
                            viewBox={`0 0 ${contentWidth} ${contentHeight}`}
                        >
                            {linkSegments.map((segment) => {
                                const active = isChipActive(segment.chipA) && isChipActive(segment.chipB);
                                const highlighted =
                                    hoveredChip !== null &&
                                    (segment.chipA === hoveredChip || segment.chipB === hoveredChip);
                                return (
                                    <line
                                        key={segment.key}
                                        className={`cluster-link ${highlighted ? 'is-highlighted' : ''} ${
                                            dimmed && !active ? 'is-dimmed' : ''
                                        }`}
                                        x1={segment.x1}
                                        y1={segment.y1}
                                        x2={segment.x2}
                                        y2={segment.y2}
                                    />
                                );
                            })}
                        </svg>

                        {chips.map((clusterChip) => {
                            const ethPosition =
                                ethPositionsByChip.get(clusterChip.id) ?? new Map<CLUSTER_ETH_POSITION, string[]>();
                            const active = isChipActive(clusterChip.id);

                            return (
                                <div
                                    className={`chip ${clusterChip.mmio ? 'is-mmio' : ''} ${
                                        clusterChip.id === hoveredChip ? 'is-hovered' : ''
                                    } ${dimmed && !active ? 'is-dimmed' : ''}`}
                                    key={clusterChip.id}
                                    onMouseEnter={() => setHoveredChip(clusterChip.id)}
                                    onMouseLeave={() => setHoveredChip(null)}
                                    style={{
                                        display: 'grid',
                                        width: `${clusterChipSize}px`,
                                        height: `${clusterChipSize}px`,
                                        gridColumn: clusterChip.coords[CLUSTER_COORDS.X] + 1,
                                        gridRow: clusterChip.coords[CLUSTER_COORDS.Y] + 1,
                                        gridTemplateColumns: `repeat(${CLUSTER_NODE_GRID_SIZE}, 1fr)`,
                                        gridTemplateRows: `repeat(${CLUSTER_NODE_GRID_SIZE}, 1fr)`,
                                        gap: `${CHIP_GAP}px`,
                                        padding: `${CHIP_PADDING}px`,
                                    }}
                                >
                                    <span
                                        className='chip-id'
                                        style={{ fontSize: `${idFontSize}px` }}
                                    >
                                        {clusterChipSize >= CLUSTER_CHIP_SIZE_MEDIUM && 'Device '}
                                        {clusterChip.id}
                                    </span>

                                    {[...ethPosition.entries()].map(([position, value]) => {
                                        return value.map((uid: string, index: number) => {
                                            const { x, y } = getEthGridPosition(position, index);
                                            const size = clusterChipSize / CLUSTER_NODE_GRID_SIZE - CHIP_GAP;
                                            // scale the label with the port so it doesn't overflow on dense meshes
                                            const ethFontSize = Math.max(4, Math.round(size / 4));
                                            return (
                                                <div
                                                    title={`${uid}`}
                                                    key={uid}
                                                    className={`eth eth-position-${position}`}
                                                    style={{
                                                        gridColumn: x,
                                                        gridRow: y,
                                                        width: `${size}px`,
                                                        height: `${size}px`,
                                                        fontSize: `${ethFontSize}px`,
                                                    }}
                                                >
                                                    <span>{uid}</span>
                                                </div>
                                            );
                                        });
                                    })}

                                    {clusterChip.mmio &&
                                        chipDesign.pcie?.map((coord, pcieIndex) => {
                                            const { left, top, size } = calculatePciePixelPosition(
                                                coord,
                                                chipDesign.grid,
                                                clusterChipSize,
                                            );
                                            return (
                                                <div
                                                    key={`pcie-${pcieIndex}`}
                                                    className='mmio'
                                                    style={{
                                                        left: `${left}px`,
                                                        top: `${top}px`,
                                                        width: `${size}px`,
                                                        height: `${size}px`,
                                                    }}
                                                >
                                                    PCIe
                                                </div>
                                            );
                                        })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ClusterRenderer;
