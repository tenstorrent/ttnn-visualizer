// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonGroup, Switch, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import 'styles/components/ClusterView.scss';
import { stringToArchitecture } from '../../definitions/DeviceArchitecture';
import { useArchitecture, useGetClusterTopology } from '../../hooks/useAPI';
import {
    FALLBACK_PER_HOST_COLS,
    hostHasMeshCoords,
    sortHostsByConnectionProximity,
} from '../../functions/clusterTopology';
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

// Condensed layout: each host tiled vertically as a `FALLBACK_PER_HOST_COLS`
// wide grid (sourced from `clusterTopology` so the host-ordering heuristic
// stays in sync). Used as a fallback when no mesh coords are present, or as
// a user-selectable alternative to the literal mesh layout. #1510
const FALLBACK_HOST_GUTTER_ROWS = 1;
// Top padding gives outward-edge curves from the topmost host room to arc
// without colliding with the cluster panel chrome.
const FALLBACK_TOP_PAD_ROWS = 2;

const ALL_EDGES: readonly CLUSTER_ETH_POSITION[] = [
    CLUSTER_ETH_POSITION.TOP,
    CLUSTER_ETH_POSITION.BOTTOM,
    CLUSTER_ETH_POSITION.LEFT,
    CLUSTER_ETH_POSITION.RIGHT,
];

interface PortPixel {
    x: number;
    y: number;
    edge: CLUSTER_ETH_POSITION;
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
    // SVG `d` attribute for inter-host cubic-Bezier curves. Intra-host links
    // are rendered as a straight `<line>`, so this is undefined for them.
    pathD?: string;
}

interface RenderChip extends ClusterChip {
    key: string;
    rank: number;
    chipUniqueId?: number;
}

// `mesh`: honour the report's `physical_chip_mesh_coordinate_mapping_*.yaml`
// (1D or 2D). `condensed`: tile each host into a per-host 4-wide grid. #1510
export type ClusterLayoutMode = 'mesh' | 'condensed';

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
    // Padding around the SVG link layer so outward-bowing curves aren't clipped.
    svgPad: number;
    // Layout actually applied (may fall back to `condensed` if `mesh` was
    // requested but no host has usable mesh data).
    layoutMode: ClusterLayoutMode;
    // Mesh layout is viable for this topology (drives the UI toggle's visibility).
    isMeshAvailable: boolean;
}

type ClusterRenderResult = { status: 'ready'; model: ClusterRenderModel } | { status: 'unsupported' };

const chipKey = (rank: number, id: number) => `${rank}-${id}`;
const ethUid = (rank: number, chipId: number, coreId: string) => `${rank}-${chipId}-${coreId}`;

// Cheap deterministic non-negative hash for distributing ports across a small
// candidate edge list. Quality only needs to be uniform over 2-3 buckets. #1510
const hashLinkKey = (key: string): number => {
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
        // eslint-disable-next-line no-bitwise
        hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
    }
    return hash < 0 ? -hash : hash;
};

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

function buildClusterRenderModel(
    topology: ClusterTopology,
    chipDesign: ChipDesign,
    requestedLayoutMode: ClusterLayoutMode = 'mesh',
): ClusterRenderResult {
    if (!chipDesign?.eth) {
        return { status: 'unsupported' };
    }

    const { hosts, isMultiHost, worldSize, intraHostLinks, interHostLinks } = topology;
    if (hosts.length === 0) {
        return { status: 'unsupported' };
    }

    // Step 1: place every chip on a global virtual grid. `mesh` honours the
    // report's mesh coords (1D or 2D); `condensed` tiles each host into a
    // 4-wide grid. Falls back to `condensed` when `mesh` was requested but no
    // host has usable mesh data, so the UI never renders an empty layout. #1510
    const isMeshAvailable = hosts.every(hostHasMeshCoords);
    const useMeshCoords = requestedLayoutMode === 'mesh' && isMeshAvailable;
    const layoutMode: ClusterLayoutMode = useMeshCoords ? 'mesh' : 'condensed';

    const renderChips: RenderChip[] = [];
    let nextHostOffsetY = useMeshCoords ? 0 : FALLBACK_TOP_PAD_ROWS;
    let totalCols = 0;
    let totalRows = 0;

    // Condensed-mode stacking: each host's connecting row faces the gutter.
    // Mesh mode keeps the report's coordinates verbatim.
    const hostsByRenderOrder = useMeshCoords ? hosts : sortHostsByConnectionProximity(hosts, interHostLinks);

    for (const host of hostsByRenderOrder) {
        const meshChipIds = Object.keys(host.meshChips).map(Number);
        const uidChipIds = Object.keys(host.descriptor.chip_unique_ids ?? {}).map(Number);
        const chipIdsForHost = (useMeshCoords ? meshChipIds : uidChipIds).sort((a, b) => a - b);

        const mmioChipIds = new Set(
            (host.descriptor.chips_with_mmio ?? []).map((obj) => Object.values(obj)[0] as number),
        );

        let usedFallback = false;

        // Plain `for` to keep mutable counters out of a closure (no-loop-func).
        for (let localIndex = 0; localIndex < chipIdsForHost.length; localIndex += 1) {
            const chipId = chipIdsForHost[localIndex];
            const meshCoord = useMeshCoords ? host.meshChips[chipId] : undefined;
            let x: number;
            let y: number;
            if (meshCoord) {
                [x, y] = meshCoord;
            } else {
                usedFallback = true;
                x = localIndex % FALLBACK_PER_HOST_COLS;
                y = nextHostOffsetY + Math.floor(localIndex / FALLBACK_PER_HOST_COLS);
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
            const hostRows = Math.ceil(chipIdsForHost.length / FALLBACK_PER_HOST_COLS);
            nextHostOffsetY += hostRows + FALLBACK_HOST_GUTTER_ROWS;
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

    // Canonical link key (lex-min of endpoint uids) shared by both ends, so
    // ordering ports by it on each edge keeps facing edges in sync.
    const canonicalLinkKeyByUid = new Map<string, string>();
    const rememberLinkKey = (uidA: string | undefined, uidB: string | undefined) => {
        if (uidA === undefined || uidB === undefined) {
            return;
        }
        const key = uidA < uidB ? uidA : uidB;
        canonicalLinkKeyByUid.set(uidA, key);
        canonicalLinkKeyByUid.set(uidB, key);
    };

    for (const link of intraHostLinks) {
        const a = chipsByKey.get(chipKey(link.rank, link.a.chip));
        const b = chipsByKey.get(chipKey(link.rank, link.b.chip));
        if (a && b) {
            recordConnection(a, b, a.eth[link.a.chan], b.eth[link.b.chan]);
            rememberLinkKey(a.eth[link.a.chan], b.eth[link.b.chan]);
        }
    }

    for (const link of interHostLinks) {
        const a = chipsByKey.get(chipKey(link.a.rank, link.a.chip));
        const b = chipsByKey.get(chipKey(link.b.rank, link.b.chip));
        if (a && b) {
            recordConnection(a, b, a.eth[link.a.chan], b.eth[link.b.chan]);
            rememberLinkKey(a.eth[link.a.chan], b.eth[link.b.chan]);
        }
    }

    // Step 3: pick which edge of each chip an ETH port sits on, based on the
    // relative position of the chip it connects to.
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
    const portPixel = (coords: ClusterCoordinates, gx: number, gy: number, edge: CLUSTER_ETH_POSITION): PortPixel => {
        const chipLeft = coords[CLUSTER_COORDS.X] * stride + CHIP_PADDING;
        const chipTop = coords[CLUSTER_COORDS.Y] * stride + CHIP_PADDING;
        const cellX = chipLeft + (gx - 1) * (cellSize + CHIP_GAP);
        const cellY = chipTop + (gy - 1) * (cellSize + CHIP_GAP);
        // Anchor the line at the OUTER edge of the port tile (not the centre)
        // so the link visibly exits/enters at the chip's boundary.
        let px = cellX + cellSize / 2;
        let py = cellY + cellSize / 2;
        if (edge === CLUSTER_ETH_POSITION.TOP) {
            py = cellY;
        } else if (edge === CLUSTER_ETH_POSITION.BOTTOM) {
            py = cellY + cellSize;
        } else if (edge === CLUSTER_ETH_POSITION.LEFT) {
            px = cellX;
        } else {
            px = cellX + cellSize;
        }
        return { x: px, y: py, edge };
    };

    const ethPositionsByChip = new Map<string, Map<CLUSTER_ETH_POSITION, string[]>>();
    const portPixelByUid = new Map<string, PortPixel>();
    // UIDs whose link skips ≥1 chip. Tagged here, rendered as curves in step 4
    // so they fly past the intermediates instead of overlapping them.
    const longHaulUids = new Set<string>();

    // ETH port placement is *adjacency*-based, not hardware-based. Each port
    // is placed on an edge derived from the chip it connects to (the port's
    // physical NoC coordinates are kept only for the label). Two passes:
    //   1. Direct cardinal neighbour → chord-direction edge.
    //   2. Long-haul / inter-host → prefer an OUTWARD edge so the curve leaves
    //      the cluster body through open space (chord if outward, else
    //      outward perpendicular, else any outward edge; interior chips fall
    //      back to first empty perpendicular).
    // Within each edge ports are sorted by partner perpendicular-axis coord
    // then canonical link key; long-haul/inter-host uids are tagged for the
    // curve renderer in step 4.
    const meshDistance = (a: ClusterCoordinates, b: ClusterCoordinates): number =>
        Math.abs(a[CLUSTER_COORDS.X] - b[CLUSTER_COORDS.X]) + Math.abs(a[CLUSTER_COORDS.Y] - b[CLUSTER_COORDS.Y]);

    const perpendicularEdges = (edge: CLUSTER_ETH_POSITION): CLUSTER_ETH_POSITION[] => {
        if (edge === CLUSTER_ETH_POSITION.LEFT || edge === CLUSTER_ETH_POSITION.RIGHT) {
            return [CLUSTER_ETH_POSITION.TOP, CLUSTER_ETH_POSITION.BOTTOM];
        }
        return [CLUSTER_ETH_POSITION.LEFT, CLUSTER_ETH_POSITION.RIGHT];
    };

    const chordDirection = (from: ClusterCoordinates, to: ClusterCoordinates): CLUSTER_ETH_POSITION | null => {
        const dx = to[CLUSTER_COORDS.X] - from[CLUSTER_COORDS.X];
        const dy = to[CLUSTER_COORDS.Y] - from[CLUSTER_COORDS.Y];
        if (dx === 0 && dy === 0) {
            return null;
        }
        if (Math.abs(dx) >= Math.abs(dy)) {
            return dx > 0 ? CLUSTER_ETH_POSITION.RIGHT : CLUSTER_ETH_POSITION.LEFT;
        }
        return dy > 0 ? CLUSTER_ETH_POSITION.BOTTOM : CLUSTER_ETH_POSITION.TOP;
    };

    // An edge is "outward" for a chip when no other chip sits immediately on
    // that side — pass 2 prefers outward edges so curves leave through open
    // space rather than overlapping intermediate chips.
    const chipKeyByGridCoord = new Map<string, string>();
    for (const chip of renderChips) {
        chipKeyByGridCoord.set(`${chip.coords[CLUSTER_COORDS.X]},${chip.coords[CLUSTER_COORDS.Y]}`, chip.key);
    }
    const isOutwardEdge = (chip: RenderChip, edge: CLUSTER_ETH_POSITION): boolean => {
        const cx = chip.coords[CLUSTER_COORDS.X];
        const cy = chip.coords[CLUSTER_COORDS.Y];
        if (edge === CLUSTER_ETH_POSITION.TOP) {
            return !chipKeyByGridCoord.has(`${cx},${cy - 1}`);
        }
        if (edge === CLUSTER_ETH_POSITION.BOTTOM) {
            return !chipKeyByGridCoord.has(`${cx},${cy + 1}`);
        }
        if (edge === CLUSTER_ETH_POSITION.LEFT) {
            return !chipKeyByGridCoord.has(`${cx - 1},${cy}`);
        }
        return !chipKeyByGridCoord.has(`${cx + 1},${cy}`);
    };

    renderChips.forEach((clusterChip) => {
        const ethPosition = new Map<CLUSTER_ETH_POSITION, string[]>();
        // Edges already claimed by direct neighbours — pass 2 avoids these.
        const directNeighbourEdges = new Set<CLUSTER_ETH_POSITION>();
        // Long-haul/inter-host placements deferred until pass 2.
        const deferred: { uid: string; chord: CLUSTER_ETH_POSITION }[] = [];

        // Pass 1: direct cardinal neighbours go on their chord edge.
        clusterChip.design?.eth.forEach((coreId) => {
            const uid = ethUid(clusterChip.rank, clusterChip.id, coreId);
            const connectedChip = clusterChip.connectedChipsByEthId.get(uid);
            if (!connectedChip) {
                return;
            }
            const chord = chordDirection(clusterChip.coords, connectedChip.coords);
            if (!chord) {
                return;
            }
            const dist = meshDistance(clusterChip.coords, connectedChip.coords);
            const sameRank = clusterChip.rank === connectedChip.rank;
            const isDirectCardinal =
                dist === 1 &&
                sameRank &&
                (clusterChip.coords[CLUSTER_COORDS.X] === connectedChip.coords[CLUSTER_COORDS.X] ||
                    clusterChip.coords[CLUSTER_COORDS.Y] === connectedChip.coords[CLUSTER_COORDS.Y]);

            if (isDirectCardinal) {
                if (!ethPosition.has(chord)) {
                    ethPosition.set(chord, []);
                }
                ethPosition.get(chord)!.push(uid);
                directNeighbourEdges.add(chord);
            } else {
                deferred.push({ uid, chord });
                if (sameRank) {
                    longHaulUids.add(uid);
                }
            }
        });

        // Pass 2: outward edge if possible (chord → outward perpendicular →
        // any outward), else first empty perpendicular for interior chips.
        // When multiple outward candidates exist (e.g. 1-column meshes where
        // both LEFT and RIGHT are outward), distribute ports by hashing the
        // canonical link key so both endpoints pick the same side and the
        // bezier bows in one direction instead of arcing across. #1510
        const outwardForChip = ALL_EDGES.filter((edge) => isOutwardEdge(clusterChip, edge));
        for (const { uid, chord } of deferred) {
            const perp = perpendicularEdges(chord);
            let chosen: CLUSTER_ETH_POSITION;
            if (outwardForChip.length === 0) {
                const emptyPerp = perp.find((e) => !directNeighbourEdges.has(e) && !ethPosition.has(e));
                const fallbackPerp = perp.find((e) => !directNeighbourEdges.has(e));
                chosen = emptyPerp ?? fallbackPerp ?? chord;
            } else if (outwardForChip.includes(chord)) {
                chosen = chord;
            } else {
                const outwardPerps = perp.filter((e) => outwardForChip.includes(e));
                const candidates = outwardPerps.length > 0 ? outwardPerps : outwardForChip;
                if (candidates.length === 1) {
                    [chosen] = candidates;
                } else {
                    const linkKey = canonicalLinkKeyByUid.get(uid) ?? uid;
                    chosen = candidates[hashLinkKey(linkKey) % candidates.length];
                }
            }
            if (!ethPosition.has(chosen)) {
                ethPosition.set(chosen, []);
            }
            ethPosition.get(chosen)!.push(uid);
        }

        // Order ports along each edge by partner perpendicular-axis coord
        // (X for horizontal edges, Y for vertical), tiebroken by canonical
        // link key so both facing edges produce matching orderings.
        ethPosition.forEach((uids, position) => {
            const isVerticalEdge = position === CLUSTER_ETH_POSITION.LEFT || position === CLUSTER_ETH_POSITION.RIGHT;
            const partnerAxis = isVerticalEdge ? CLUSTER_COORDS.Y : CLUSTER_COORDS.X;
            const sorted = [...uids].sort((uidA, uidB) => {
                const partnerA = clusterChip.connectedChipsByEthId.get(uidA);
                const partnerB = clusterChip.connectedChipsByEthId.get(uidB);
                if (partnerA && partnerB) {
                    const delta = partnerA.coords[partnerAxis] - partnerB.coords[partnerAxis];
                    if (delta !== 0) {
                        return delta;
                    }
                }
                const keyA = canonicalLinkKeyByUid.get(uidA) ?? uidA;
                const keyB = canonicalLinkKeyByUid.get(uidB) ?? uidB;
                return keyA.localeCompare(keyB);
            });
            sorted.forEach((uid, index) => {
                const { x, y } = getEthGridPosition(position, index);
                portPixelByUid.set(uid, portPixel(clusterChip.coords, x, y, position));
            });
            ethPosition.set(position, sorted);
        });

        ethPositionsByChip.set(clusterChip.key, ethPosition);
    });

    // Step 4: build SVG link segments. Direct intra-host → straight line;
    // long-haul intra-host + inter-host → cubic-Bezier curve so the link
    // visibly flies past intermediate chips.
    const linkSegments: LinkSegment[] = [];

    // Cubic-Bezier control points are projected outward along each port edge's
    // normal. Control distance = max(stride * 0.4, dist * 0.22): the stride
    // floor keeps short hops visibly bowed; the distance term lets long hops
    // swing wider without arcing far past the gutter region.
    const outwardNormal = (edge: CLUSTER_ETH_POSITION): { x: number; y: number } => {
        switch (edge) {
            case CLUSTER_ETH_POSITION.TOP:
                return { x: 0, y: -1 };
            case CLUSTER_ETH_POSITION.BOTTOM:
                return { x: 0, y: 1 };
            case CLUSTER_ETH_POSITION.LEFT:
                return { x: -1, y: 0 };
            case CLUSTER_ETH_POSITION.RIGHT:
            default:
                return { x: 1, y: 0 };
        }
    };
    const swooshPath = (a: PortPixel, b: PortPixel): string => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ctrl = Math.max(stride * 0.4, dist * 0.22);
        const na = outwardNormal(a.edge);
        const nb = outwardNormal(b.edge);
        const cax = a.x + na.x * ctrl;
        const cay = a.y + na.y * ctrl;
        const cbx = b.x + nb.x * ctrl;
        const cby = b.y + nb.y * ctrl;
        return `M ${a.x} ${a.y} C ${cax} ${cay}, ${cbx} ${cby}, ${b.x} ${b.y}`;
    };

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
        // Inter-host always curves; intra-host curves only when long-haul.
        const longHaul = !interHost && (longHaulUids.has(uidA ?? '') || longHaulUids.has(uidB ?? ''));
        const useCurve = interHost || longHaul;
        linkSegments.push({
            key: `${prefix}__${uidA}__${uidB}__${index}`,
            x1: portA.x,
            y1: portA.y,
            x2: portB.x,
            y2: portB.y,
            chipKeyA: a.key,
            chipKeyB: b.key,
            interHost,
            pathD: useCurve ? swooshPath(portA, portB) : undefined,
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
            svgPad: Math.round(stride),
            layoutMode,
            isMeshAvailable,
        },
    };
}

function ClusterRenderer() {
    const navigate = useNavigate();
    const { data: topology } = useGetClusterTopology();

    // `null` zoom = auto-fit; any number is an explicit user-set zoom.
    const [userZoom, setUserZoom] = useState<number | null>(null);
    const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
    const [hoveredChip, setHoveredChip] = useState<string | null>(null);
    // Layout override keyed by the topology it was set against — pairing it
    // with the topology makes it expire automatically when the report changes.
    const [layoutOverride, setLayoutOverride] = useState<{
        mode: ClusterLayoutMode;
        topology: ClusterTopology;
    } | null>(null);

    // Heterogeneous clusters aren't supported yet; assume the first host's arch.
    const firstHostArch = topology?.hosts[0]?.descriptor.arch ?? [];
    const arch = stringToArchitecture((firstHostArch.length && firstHostArch[0]) || DEFAULT_ARCHITECTURE);
    const chipDesign = useArchitecture(arch);

    // Honour the report's mesh coords (1D or 2D) when present; otherwise pick
    // `condensed` upfront rather than silently falling back inside the builder. #1510
    const defaultLayoutMode: ClusterLayoutMode = useMemo(() => {
        if (!topology || topology.hosts.length === 0) {
            return 'condensed';
        }
        return topology.hosts.every(hostHasMeshCoords) ? 'mesh' : 'condensed';
    }, [topology]);
    // Stale override (user switched reports) is ignored.
    const requestedLayoutMode: ClusterLayoutMode =
        layoutOverride && layoutOverride.topology === topology ? layoutOverride.mode : defaultLayoutMode;
    const setUserLayoutMode = useCallback(
        (mode: ClusterLayoutMode) => {
            if (topology) {
                setLayoutOverride({ mode, topology });
            }
        },
        [topology],
    );

    const renderResult = useMemo(() => {
        if (!topology) {
            return null;
        }
        return buildClusterRenderModel(topology, chipDesign, requestedLayoutMode);
    }, [topology, chipDesign, requestedLayoutMode]);

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
        // Padding lets outward-bowing curves render outside the grid bounds.
        svgPad,
        isMultiHost,
        worldSize,
        layoutMode: activeLayoutMode,
        isMeshAvailable,
    } = renderResult.model;

    const isChipActive = (key: string) => {
        if (hoveredChip === null) {
            return true;
        }
        return key === hoveredChip || !!neighboursByChip.get(hoveredChip)?.has(key);
    };

    const header = (
        <div className='cluster-view-header'>
            <div className='cluster-view-controls'>
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
                {isMultiHost && isMeshAvailable && (
                    <Tooltip content='Switch between honouring the report mesh coordinates and a condensed 4-wide grid'>
                        <Switch
                            className='cluster-view-layout-toggle'
                            label='Condensed layout'
                            checked={activeLayoutMode === 'condensed'}
                            onChange={() => setUserLayoutMode(activeLayoutMode === 'condensed' ? 'mesh' : 'condensed')}
                            aria-label='Toggle between mesh-aware and condensed cluster layout'
                        />
                    </Tooltip>
                )}
            </div>
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
                            width={contentWidth + svgPad * 2}
                            height={contentHeight + svgPad * 2}
                            viewBox={`${-svgPad} ${-svgPad} ${contentWidth + svgPad * 2} ${contentHeight + svgPad * 2}`}
                            style={{ left: -svgPad, top: -svgPad }}
                        >
                            {linkSegments.map((segment) => {
                                const active = isChipActive(segment.chipKeyA) && isChipActive(segment.chipKeyB);
                                const highlighted =
                                    hoveredChip !== null &&
                                    (segment.chipKeyA === hoveredChip || segment.chipKeyB === hoveredChip);
                                const linkClass = classNames('cluster-link', {
                                    'is-highlighted': highlighted,
                                    'is-dimmed': dimmed && !active,
                                    'is-inter-host': segment.interHost,
                                });
                                if (segment.pathD) {
                                    return (
                                        <path
                                            key={segment.key}
                                            className={linkClass}
                                            d={segment.pathD}
                                            fill='none'
                                        />
                                    );
                                }
                                return (
                                    <line
                                        key={segment.key}
                                        className={linkClass}
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
