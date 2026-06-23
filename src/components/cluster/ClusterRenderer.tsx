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
// *vertically* with the highest rank at the top and rank 0 at the bottom — the
// arrangement that reads as "remote → local" top-down for a multi-host run.
// Each host arranges its chips in a 4-column grid stacked into rows.
// Chosen because most current reports are 1- or 2-host with ≤ 8 chips per host;
// deeper packing can come with a proper mesh-aware layout once the
// mesh-descriptor multi-doc YAML quirk (see plan doc) is resolved upstream.
const FALLBACK_PER_HOST_COLS = 4;
const FALLBACK_HOST_GUTTER_ROWS = 1;

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
    // Extra pixels added to each side of the SVG link layer so outward-bowing
    // curves aren't clipped by the bounding box. Sized in `buildClusterRenderModel`
    // from the chip stride.
    svgPad: number;
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
    // when *every* host has a true 2D arrangement (both x and y axes vary);
    // otherwise fall back to a per-host 4-wide grid tiled *vertically* with the
    // highest rank at the top and rank 0 at the bottom. A degenerate 1D mesh
    // (e.g. `physical_chip_mesh_coordinate_mapping_*.yaml` in
    // multihost_poc_jun19_2043 packs all chips into mesh_x=0) collapses every
    // chip into a single column, which forces the eth-port placement logic
    // (relative-neighbour-direction below) to cluster all ports on the
    // TOP/BOTTOM edges and doesn't match the physical chip board geometry.
    const hostHasTwoDimensionalMesh = (host: ClusterTopology['hosts'][number]) => {
        const coords = Object.values(host.meshChips);
        if (coords.length === 0) {
            return false;
        }
        const xs = new Set<number>();
        const ys = new Set<number>();
        for (const coord of coords) {
            xs.add(coord[0]);
            ys.add(coord[1]);
        }
        return xs.size > 1 && ys.size > 1;
    };
    const useMeshCoords = hosts.every(hostHasTwoDimensionalMesh);

    const renderChips: RenderChip[] = [];
    let nextHostOffsetY = 0;
    let totalCols = 0;
    let totalRows = 0;

    // Stacking order is driven by where each host's inter-host connection
    // chips sit in its local fallback grid (row 0 = top, row 1 = bottom of a
    // 2-row tile). The host whose connecting chips cluster near its BOTTOM
    // row is placed FIRST (top of the stack) so that bottom row faces the
    // gutter; the host whose connecting chips cluster near its TOP row is
    // placed last so its top row faces the gutter from below. Ties (and the
    // single-host case) fall back to rank-descending. Mesh-aware mode keeps
    // the report's coordinates unchanged.
    const fallbackLocalGridYForChip = new Map<string, number>();
    for (const host of hosts) {
        const uidChipIds = Object.keys(host.descriptor.chip_unique_ids ?? {})
            .map(Number)
            .sort((a, b) => a - b);
        uidChipIds.forEach((chipId, idx) => {
            fallbackLocalGridYForChip.set(`${host.rank}-${chipId}`, Math.floor(idx / FALLBACK_PER_HOST_COLS));
        });
    }
    const meanLocalYByRank = new Map<number, number>();
    const accumByRank = new Map<number, { sum: number; count: number }>();
    for (const link of interHostLinks) {
        for (const endpoint of [link.a, link.b] as const) {
            const localY = fallbackLocalGridYForChip.get(`${endpoint.rank}-${endpoint.chip}`);
            if (localY !== undefined) {
                const acc = accumByRank.get(endpoint.rank) ?? { sum: 0, count: 0 };
                acc.sum += localY;
                acc.count += 1;
                accumByRank.set(endpoint.rank, acc);
            }
        }
    }
    accumByRank.forEach((acc, rank) => meanLocalYByRank.set(rank, acc.sum / acc.count));
    const hostsByRenderOrder = useMeshCoords
        ? hosts
        : [...hosts].sort((a, b) => {
              const ya = meanLocalYByRank.get(a.rank);
              const yb = meanLocalYByRank.get(b.rank);
              if (ya !== undefined && yb !== undefined && ya !== yb) {
                  return yb - ya;
              }
              return b.rank - a.rank;
          });

    for (const host of hostsByRenderOrder) {
        const meshChipIds = Object.keys(host.meshChips).map(Number);
        const uidChipIds = Object.keys(host.descriptor.chip_unique_ids ?? {}).map(Number);
        const chipIdsForHost = (useMeshCoords ? meshChipIds : uidChipIds).sort((a, b) => a - b);

        const mmioChipIds = new Set(
            (host.descriptor.chips_with_mmio ?? []).map((obj) => Object.values(obj)[0] as number),
        );

        let usedFallback = false;

        // Plain `for` to avoid a closure that captures mutable outer-scope
        // counters (eslint `no-loop-func`).
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
    const portPixel = (coords: ClusterCoordinates, gx: number, gy: number, edge: CLUSTER_ETH_POSITION): PortPixel => {
        const chipLeft = coords[CLUSTER_COORDS.X] * stride + CHIP_PADDING;
        const chipTop = coords[CLUSTER_COORDS.Y] * stride + CHIP_PADDING;
        return {
            x: chipLeft + (gx - 1) * (cellSize + CHIP_GAP) + cellSize / 2,
            y: chipTop + (gy - 1) * (cellSize + CHIP_GAP) + cellSize / 2,
            edge,
        };
    };

    const ethPositionsByChip = new Map<string, Map<CLUSTER_ETH_POSITION, string[]>>();
    const portPixelByUid = new Map<string, PortPixel>();
    // UIDs whose connection skips over one or more chips (intra-host non-adjacent,
    // e.g. chip 5 ↔ chip 7 with chip 6 between them) — these are placed on a
    // perpendicular empty edge in pass 2 and rendered as curves rather than
    // straight lines so they don't visually overlap the chord they fly above.
    const longHaulUids = new Set<string>();

    // ETH port placement is *adjacency*-based, not hardware-based:
    //
    //   - The chip-design JSON enumerates 16 ethernet cores per chip with their
    //     physical NoC-grid coordinates (e.g. wormhole has 8 cores at y=0 and
    //     8 at y=6). Those coordinates are encoded in the eth port label
    //     (e.g. `0-20-7-6` = rank 0, chip 20, core at chip-grid x=7, y=6) but
    //     are NOT used to decide which edge of the rendered chip a port sits on.
    //
    //   - Instead, each port is positioned on the edge that *faces the chip
    //     it connects to*: neighbour to my west → port on my LEFT edge,
    //     neighbour above me → TOP, etc. Disconnected channels are not rendered.
    //
    //   - Within an edge, ports are slotted in the discovery order of channels
    //     (the `index` argument to `getEthGridPosition`), so the relative
    //     ordering reflects the channel numbering in `ethernet_connections`.
    //
    //   - **Long-haul intra-host links** (same rank, mesh distance > 1, e.g.
    //     chip 5 ↔ chip 7 with chip 6 in between) bypass the direct-neighbour
    //     edge and are placed on a *perpendicular* empty edge so they don't
    //     stack with the direct connection that already occupies the chord
    //     edge. They're paired with a Bezier curve in step 4 so they visibly
    //     fly over/under the intermediate chip(s) instead of overlapping
    //     adjacent ports.
    //
    // This means a hardware "top-row" core can render on the chip's LEFT edge
    // (or any other) — its physical NoC location is informational only.
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

    // Outward-edge lookup: an edge is "outward" for a chip if no other chip on
    // the rendered grid sits immediately on that side. Long-haul intra-host
    // and inter-host ports (deferred from pass 1) prefer outward edges so the
    // bezier curve can leave the host cluster through open space instead of
    // overlapping intermediate chips.
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
        // Edges occupied by direct cardinal-neighbour connections — pass 2
        // will avoid these when placing long-haul ports.
        const directNeighbourEdges = new Set<CLUSTER_ETH_POSITION>();
        // Long-haul placements deferred until after pass 1 so we know which
        // edges the direct-neighbour connections claimed.
        const deferred: { uid: string; chord: CLUSTER_ETH_POSITION }[] = [];

        // Pass 1: place direct cardinal neighbours on their facing edge; defer
        // everything else (diagonals, non-adjacent same-rank, inter-host).
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
                // Long-haul or inter-host: defer placement until we know which
                // edges the direct-neighbour connections claimed.
                deferred.push({ uid, chord });
                if (sameRank) {
                    longHaulUids.add(uid);
                }
            }
        });

        // Pass 2: prefer the chip's outward edges so curves can leave the host
        // cluster through open space:
        //   a) chord edge if it's outward (partner lies in that direction and
        //      nothing blocks it on this chip's side)
        //   b) any other outward edge — perpendicular first (cleaner from a
        //      chord-edge-already-occupied-by-direct-cardinal standpoint),
        //      otherwise the remaining outward edge (e.g. opposite of chord)
        //   c) interior-chip fallback: the legacy "first empty perpendicular"
        //      behaviour for chips that have no outward edges at all.
        const ALL_EDGES: CLUSTER_ETH_POSITION[] = [
            CLUSTER_ETH_POSITION.TOP,
            CLUSTER_ETH_POSITION.BOTTOM,
            CLUSTER_ETH_POSITION.LEFT,
            CLUSTER_ETH_POSITION.RIGHT,
        ];
        for (const { uid, chord } of deferred) {
            const outward = ALL_EDGES.filter((edge) => isOutwardEdge(clusterChip, edge));
            const perp = perpendicularEdges(chord);
            let chosen: CLUSTER_ETH_POSITION;
            if (outward.length === 0) {
                const emptyPerp = perp.find((e) => !directNeighbourEdges.has(e) && !ethPosition.has(e));
                const fallbackPerp = perp.find((e) => !directNeighbourEdges.has(e));
                chosen = emptyPerp ?? fallbackPerp ?? chord;
            } else if (outward.includes(chord)) {
                chosen = chord;
            } else {
                chosen = perp.find((e) => outward.includes(e)) ?? outward[0];
            }
            if (!ethPosition.has(chosen)) {
                ethPosition.set(chosen, []);
            }
            ethPosition.get(chosen)!.push(uid);
        }

        ethPosition.forEach((uids, position) => {
            uids.forEach((uid, index) => {
                const { x, y } = getEthGridPosition(position, index);
                portPixelByUid.set(uid, portPixel(clusterChip.coords, x, y, position));
            });
        });

        ethPositionsByChip.set(clusterChip.key, ethPosition);
    });

    // Step 4: derive link segments (positioned line endpoints) for the SVG layer.
    // Three flavours:
    //   - direct intra-host (mesh distance 1): straight `<line>`
    //   - long-haul intra-host (skips ≥1 chip in between): cubic-Bezier curve
    //     so the link visibly flies over/under the intermediate chip(s)
    //   - inter-host: cubic-Bezier curve with dashed-teal styling
    const linkSegments: LinkSegment[] = [];

    // Cubic-Bezier curve whose control points are projected outward from each
    // endpoint along the port edge's outward normal:
    //
    //         outNormal(TOP)    = ( 0,-1)
    //         outNormal(BOTTOM) = ( 0,+1)
    //         outNormal(LEFT)   = (-1, 0)
    //         outNormal(RIGHT)  = (+1, 0)
    //
    // Control distance = max(stride * 0.65, dist * 0.4). The stride floor
    // keeps short hops visibly bowed; the distance term lets long hops swing
    // wider. This guarantees the curve *leaves the source chip going outward*
    // and *enters the destination chip from outside*, regardless of how the
    // two endpoints are aligned, which fixes the previous degenerate case
    // where two ports stacked on parallel edges with nearly the same x (e.g.
    // inter-host straight below) collapsed into a line passing through every
    // chip in between.
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
        const ctrl = Math.max(stride * 0.65, dist * 0.4);
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
        // Inter-host always curves. Intra-host curves only when long-haul
        // (port was displaced to a perpendicular empty edge in pass 2 above).
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
        // Extend the SVG canvas beyond the chip grid so outward-bowing curves
        // (long-haul intra-host, inter-host) aren't clipped by the bounding
        // box. The grid itself stays the same size — only the link layer is
        // oversized via negative `left`/`top` and an expanded viewBox.
        svgPad,
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
                                    // Inter-host links use a cubic-Bezier path so a bundle of
                                    // parallel cross-host connections fans out visibly instead
                                    // of stacking into a single straight bar.
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
