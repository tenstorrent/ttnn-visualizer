// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonGroup, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import 'styles/components/ClusterView.scss';
import { stringToArchitecture } from '../../definitions/DeviceArchitecture';
import { useArchitecture, useGetClusterTopology } from '../../hooks/useAPI';
import {
    CLUSTER_COORDS,
    CLUSTER_ETH_POSITION,
    ChipDesign,
    ClusterChip,
    ClusterCoordinates,
    ClusterTopology,
    DEFAULT_ARCHITECTURE,
} from '../../model/ClusterModel';
import {
    CHIP_GAP,
    CHIP_PADDING,
    CLUSTER_NODE_GRID_SIZE,
    calculatePciePixelPosition,
} from '../../functions/clusterPositioning';

const CLUSTER_CHIP_SIZE_LARGE = 350;
const CLUSTER_CHIP_SIZE_MEDIUM = 250;
const CLUSTER_CHIP_SIZE_SMALL = 150;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.15;
// Scale factor for pixel-mode wheel events (trackpad/pinch). Keeps pinch
// proportional to gesture size rather than firing a fixed step per frame.
const ZOOM_PIXEL_SCALE = 0.004;

const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

// Per-host fallback layout when mesh coordinates are missing. Hosts are tiled
// horizontally; each host arranges its chips in a 4-column grid stacked into
// rows. Chosen because most current reports are 1- or 2-host with ≤ 8 chips
// per host; deeper packing can come with a proper mesh-aware layout once the
// mesh-descriptor multi-doc YAML quirk (see plan doc) is resolved upstream.
const FALLBACK_PER_HOST_COLS = 4;
const FALLBACK_HOST_GUTTER_COLS = 1;

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
    chipKeyA: string;
    chipKeyB: string;
    interHost: boolean;
}

interface RenderChip extends ClusterChip {
    key: string;
    rank: number;
    chipUniqueId?: number;
}

interface ClusterRenderModel {
    chips: RenderChip[];
    chipsByKey: Map<string, RenderChip>;
    neighboursByChip: Map<string, Set<string>>;
    clusterChipSize: number;
    totalCols: number;
    totalRows: number;
    contentWidth: number;
    contentHeight: number;
    ethPositionsByChip: Map<string, Map<CLUSTER_ETH_POSITION, string[]>>;
    linkSegments: LinkSegment[];
    idFontSize: number;
    isMultiHost: boolean;
    worldSize: number;
}

type ClusterRenderResult = { status: 'ready'; model: ClusterRenderModel } | { status: 'unsupported' };

const chipKey = (rank: number, id: number) => `${rank}-${id}`;
const ethUid = (rank: number, chipId: number, coreId: string) => `${rank}-${chipId}-${coreId}`;

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

function buildClusterRenderModel(topology: ClusterTopology, chipDesign: ChipDesign): ClusterRenderResult {
    if (!chipDesign?.eth) {
        return { status: 'unsupported' };
    }

    const { hosts, isMultiHost, worldSize, intraHostLinks, interHostLinks } = topology;
    if (hosts.length === 0) {
        return { status: 'unsupported' };
    }

    // Step 1: place every chip on a global virtual grid. Prefer mesh coordinates
    // when the host provides them; otherwise fall back to a per-host 4-wide grid
    // tiled horizontally across hosts.
    const renderChips: RenderChip[] = [];
    let nextHostOffsetX = 0;
    let totalCols = 0;
    let totalRows = 0;

    for (const host of hosts) {
        const meshChipIds = Object.keys(host.meshChips).map(Number);
        const uidChipIds = Object.keys(host.descriptor.chip_unique_ids ?? {}).map(Number);
        const chipIdsForHost = (meshChipIds.length > 0 ? meshChipIds : uidChipIds).sort((a, b) => a - b);

        const mmioChipIds = new Set(
            (host.descriptor.chips_with_mmio ?? []).map((obj) => Object.values(obj)[0] as number),
        );

        let usedFallback = false;

        // Plain `for` to avoid a closure that captures mutable outer-scope
        // counters (eslint `no-loop-func`).
        for (let localIndex = 0; localIndex < chipIdsForHost.length; localIndex += 1) {
            const chipId = chipIdsForHost[localIndex];
            const meshCoord = host.meshChips[chipId];
            let x: number;
            let y: number;
            if (meshCoord) {
                [x, y] = meshCoord;
            } else {
                usedFallback = true;
                x = nextHostOffsetX + (localIndex % FALLBACK_PER_HOST_COLS);
                y = Math.floor(localIndex / FALLBACK_PER_HOST_COLS);
            }
            totalCols = Math.max(totalCols, x + 1);
            totalRows = Math.max(totalRows, y + 1);

            renderChips.push({
                key: chipKey(host.rank, chipId),
                rank: host.rank,
                id: chipId,
                chipUniqueId: host.descriptor.chip_unique_ids?.[chipId],
                coords: [x, y, 0, 0] satisfies ClusterCoordinates,
                mmio: mmioChipIds.has(chipId),
                eth: chipDesign.eth.map((coreId) => ethUid(host.rank, chipId, coreId)),
                connectedChipsByEthId: new Map(),
                design: chipDesign,
            });
        }

        if (usedFallback) {
            const hostCols = Math.min(chipIdsForHost.length, FALLBACK_PER_HOST_COLS);
            nextHostOffsetX += hostCols + FALLBACK_HOST_GUTTER_COLS;
        }
    }

    const chipsByKey = new Map<string, RenderChip>(renderChips.map((c) => [c.key, c]));

    // Step 2: wire intra-host and inter-host eth connections into each chip's
    // `connectedChipsByEthId` map so the port-positioning step below can compute
    // edges relative to neighbours.
    const recordConnection = (
        chipA: RenderChip,
        chipB: RenderChip,
        uidA: string | undefined,
        uidB: string | undefined,
    ) => {
        if (uidA === undefined || uidB === undefined) {
            return;
        }
        chipA.connectedChipsByEthId.set(uidA, chipB);
        chipB.connectedChipsByEthId.set(uidB, chipA);
    };

    for (const link of intraHostLinks) {
        const a = chipsByKey.get(chipKey(link.rank, link.a.chip));
        const b = chipsByKey.get(chipKey(link.rank, link.b.chip));
        if (a && b) {
            recordConnection(a, b, a.eth[link.a.chan], b.eth[link.b.chan]);
        }
    }

    for (const link of interHostLinks) {
        const a = chipsByKey.get(chipKey(link.a.rank, link.a.chip));
        const b = chipsByKey.get(chipKey(link.b.rank, link.b.chip));
        if (a && b) {
            recordConnection(a, b, a.eth[link.a.chan], b.eth[link.b.chan]);
        }
    }

    // Step 3: figure out which edge of each chip its ETH ports live on, based
    // on the relative coordinates of the neighbour they connect to.
    let clusterChipSize = CLUSTER_CHIP_SIZE_LARGE;
    if (renderChips.length >= 8) {
        clusterChipSize = CLUSTER_CHIP_SIZE_MEDIUM;
    }
    if (renderChips.length >= 32) {
        clusterChipSize = CLUSTER_CHIP_SIZE_SMALL;
    }

    const stride = clusterChipSize + CHIP_GAP;
    const contentWidth = totalCols * clusterChipSize + Math.max(0, totalCols - 1) * CHIP_GAP;
    const contentHeight = totalRows * clusterChipSize + Math.max(0, totalRows - 1) * CHIP_GAP;
    const cellSize =
        (clusterChipSize - CHIP_PADDING * 2 - (CLUSTER_NODE_GRID_SIZE - 1) * CHIP_GAP) / CLUSTER_NODE_GRID_SIZE;
    const portPixel = (coords: ClusterCoordinates, gx: number, gy: number): PortPixel => {
        const chipLeft = coords[CLUSTER_COORDS.X] * stride + CHIP_PADDING;
        const chipTop = coords[CLUSTER_COORDS.Y] * stride + CHIP_PADDING;
        return {
            x: chipLeft + (gx - 1) * (cellSize + CHIP_GAP) + cellSize / 2,
            y: chipTop + (gy - 1) * (cellSize + CHIP_GAP) + cellSize / 2,
        };
    };

    const ethPositionsByChip = new Map<string, Map<CLUSTER_ETH_POSITION, string[]>>();
    const portPixelByUid = new Map<string, PortPixel>();

    renderChips.forEach((clusterChip) => {
        const ethPosition = new Map<CLUSTER_ETH_POSITION, string[]>();

        clusterChip.design?.eth.forEach((coreId) => {
            const uid = ethUid(clusterChip.rank, clusterChip.id, coreId);
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

        ethPositionsByChip.set(clusterChip.key, ethPosition);
    });

    // Step 4: derive link segments (positioned line endpoints) for the SVG layer,
    // tagging each segment as intra- or inter-host so styling can differentiate.
    const linkSegments: LinkSegment[] = [];

    const pushSegment = (
        a: RenderChip,
        b: RenderChip,
        uidA: string | undefined,
        uidB: string | undefined,
        interHost: boolean,
        prefix: string,
        index: number,
    ) => {
        const portA = uidA ? portPixelByUid.get(uidA) : undefined;
        const portB = uidB ? portPixelByUid.get(uidB) : undefined;
        if (!portA || !portB) {
            return;
        }
        linkSegments.push({
            key: `${prefix}__${uidA}__${uidB}__${index}`,
            x1: portA.x,
            y1: portA.y,
            x2: portB.x,
            y2: portB.y,
            chipKeyA: a.key,
            chipKeyB: b.key,
            interHost,
        });
    };

    intraHostLinks.forEach((link, index) => {
        const a = chipsByKey.get(chipKey(link.rank, link.a.chip));
        const b = chipsByKey.get(chipKey(link.rank, link.b.chip));
        if (a && b) {
            pushSegment(a, b, a.eth[link.a.chan], b.eth[link.b.chan], false, 'intra', index);
        }
    });

    interHostLinks.forEach((link, index) => {
        const a = chipsByKey.get(chipKey(link.a.rank, link.a.chip));
        const b = chipsByKey.get(chipKey(link.b.rank, link.b.chip));
        if (a && b) {
            pushSegment(a, b, a.eth[link.a.chan], b.eth[link.b.chan], true, 'inter', index);
        }
    });

    const neighboursByChip = new Map<string, Set<string>>();
    const noteNeighbour = (a: string, b: string) => {
        if (!neighboursByChip.has(a)) {
            neighboursByChip.set(a, new Set());
        }
        neighboursByChip.get(a)?.add(b);
    };
    linkSegments.forEach((segment) => {
        noteNeighbour(segment.chipKeyA, segment.chipKeyB);
        noteNeighbour(segment.chipKeyB, segment.chipKeyA);
    });

    const idFontSize = clusterChipSize >= CLUSTER_CHIP_SIZE_MEDIUM ? 30 : 20;

    return {
        status: 'ready',
        model: {
            chips: renderChips,
            chipsByKey,
            neighboursByChip,
            clusterChipSize,
            totalCols,
            totalRows,
            contentWidth,
            contentHeight,
            ethPositionsByChip,
            linkSegments,
            idFontSize,
            isMultiHost,
            worldSize,
        },
    };
}

function ClusterRenderer() {
    const navigate = useNavigate();
    const { data: topology } = useGetClusterTopology();

    // `userZoom === null` means "auto-fit to the available space"; any number is an
    // explicit zoom the user has dialled in.
    const [userZoom, setUserZoom] = useState<number | null>(null);
    const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
    const [hoveredChip, setHoveredChip] = useState<string | null>(null);

    // we don't support mixed architecture for now (see issue #1510 follow-ups)
    // we will default to wormhole and use the first host's arch when present
    const firstHostArch = topology?.hosts[0]?.descriptor.arch ?? [];
    const arch = stringToArchitecture((firstHostArch.length && firstHostArch[0]) || DEFAULT_ARCHITECTURE);
    const chipDesign = useArchitecture(arch);

    const renderResult = useMemo(() => {
        if (!topology) {
            return null;
        }
        return buildClusterRenderModel(topology, chipDesign);
    }, [topology, chipDesign]);

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

    const renderModel = renderResult?.status === 'ready' ? renderResult.model : null;

    const fitZoom =
        containerSize && renderModel
            ? Math.max(
                  ZOOM_MIN,
                  Math.min(
                      containerSize.width / renderModel.contentWidth,
                      containerSize.height / renderModel.contentHeight,
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

    if (!topology) {
        return (
            <div className='cluster-view-renderer'>
                {closeButton}
                <div className='cluster-view-wrap'>
                    <p>Loading...</p>
                </div>
            </div>
        );
    }

    if (renderResult?.status === 'unsupported') {
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

    if (renderResult?.status !== 'ready') {
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
        isMultiHost,
        worldSize,
    } = renderResult.model;

    const isChipActive = (key: string) => {
        if (hoveredChip === null) {
            return true;
        }
        return key === hoveredChip || !!neighboursByChip.get(hoveredChip)?.has(key);
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
                {isMultiHost && (
                    <>
                        <span className='legend-item'>
                            <span className='legend-line legend-line-inter-host' /> Cross-host link
                        </span>
                        <span
                            className='legend-item legend-multihost-tag'
                            aria-label={`Multi-host report with ${worldSize} ranks`}
                        >
                            multi-host · {worldSize} ranks
                        </span>
                    </>
                )}
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
                        className={classNames('cluster', { 'is-dimmed': dimmed, 'is-multihost': isMultiHost })}
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
                                const active = isChipActive(segment.chipKeyA) && isChipActive(segment.chipKeyB);
                                const highlighted =
                                    hoveredChip !== null &&
                                    (segment.chipKeyA === hoveredChip || segment.chipKeyB === hoveredChip);
                                return (
                                    <line
                                        key={segment.key}
                                        className={classNames('cluster-link', {
                                            'is-highlighted': highlighted,
                                            'is-dimmed': dimmed && !active,
                                            'is-inter-host': segment.interHost,
                                        })}
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
                                ethPositionsByChip.get(clusterChip.key) ?? new Map<CLUSTER_ETH_POSITION, string[]>();
                            const active = isChipActive(clusterChip.key);
                            const titleParts = [`Device ${clusterChip.id}`];
                            if (isMultiHost) {
                                titleParts.unshift(`Rank ${clusterChip.rank}`);
                            }
                            if (clusterChip.chipUniqueId !== undefined) {
                                titleParts.push(`uid ${clusterChip.chipUniqueId}`);
                            }
                            const chipTitle = titleParts.join(' · ');

                            return (
                                <div
                                    className={classNames('chip', {
                                        'is-mmio': clusterChip.mmio,
                                        'is-hovered': clusterChip.key === hoveredChip,
                                        'is-dimmed': dimmed && !active,
                                    })}
                                    key={clusterChip.key}
                                    title={chipTitle}
                                    data-rank={clusterChip.rank}
                                    onMouseEnter={() => setHoveredChip(clusterChip.key)}
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
                                    }}
                                >
                                    <span
                                        className='chip-id'
                                        style={{ fontSize: `${idFontSize}px` }}
                                    >
                                        {clusterChipSize >= CLUSTER_CHIP_SIZE_MEDIUM && 'Device '}
                                        {clusterChip.id}
                                    </span>

                                    {isMultiHost && (
                                        <span
                                            className='chip-rank-badge'
                                            aria-label={`Host rank ${clusterChip.rank}`}
                                        >
                                            R{clusterChip.rank}
                                        </span>
                                    )}

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
