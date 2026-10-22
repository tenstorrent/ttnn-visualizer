// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterRenderer from '../src/components/cluster/ClusterRenderer';
import { CHIP_GAP } from '../src/functions/clusterPositioning';
import type { ClusterTopology } from '../src/model/ClusterModel';

// Links that span more than one cell used to be drawn over every chip between their ends.
// These render the issue's shape and check the drawn geometry against the chips. Same
// harness as ClusterCondensedPlacement.spec.tsx. #1951
let topologyOverride: ClusterTopology | null = null;

vi.mock('react-router', async () => ({
    ...(await vi.importActual<typeof import('react-router')>('react-router')),
    useNavigate: () => vi.fn(),
}));
vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    useGetClusterTopology: () => ({
        data: topologyOverride,
        isLoading: false,
        isError: false,
        error: null,
    }),
}));

/* eslint-disable class-methods-use-this -- no-op stub has nothing to hold */
class ResizeObserverStub {
    observe() {}

    unobserve() {}

    disconnect() {}
}
/* eslint-enable class-methods-use-this */

const REPORTED_WIDTH = 400;

/** Reports a container narrower than the UBB layout, so fit-to-screen has to zoom out. */
class ReportingResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe() {
        this.callback(
            [{ contentRect: { width: REPORTED_WIDTH, height: 10_000 } }] as unknown as ResizeObserverEntry[],
            this as unknown as ResizeObserver,
        );
    }

    /* eslint-disable class-methods-use-this -- no-op stub has nothing to hold */
    unobserve() {}

    disconnect() {}
    /* eslint-enable class-methods-use-this */
}

type Endpoint = { chip: number; chan: number };

interface HostSpec {
    chipCount: number;
    /** Chip pairs to link, each with its channel count. */
    links: [number, number, number][];
    slots?: boolean;
    mesh?: boolean;
}

const topologyOf = ({ chipCount, links, slots, mesh }: HostSpec): ClusterTopology => {
    const chipIds = Array.from({ length: chipCount }, (_, chip) => chip);
    const nextChannel = new Map<number, number>();
    const channelOf = (chip: number) => {
        const chan = nextChannel.get(chip) ?? 0;
        nextChannel.set(chip, chan + 1);
        return chan;
    };
    const connections: [Endpoint, Endpoint][] = links.flatMap(([a, b, channels]) =>
        Array.from({ length: channels }, (): [Endpoint, Endpoint] => [
            { chip: a, chan: channelOf(a) },
            { chip: b, chan: channelOf(b) },
        ]),
    );
    return {
        isMultiHost: false,
        worldSize: 1,
        unresolvedRemoteCount: 0,
        hosts: [
            {
                rank: 0,
                descriptor: {
                    arch: Object.fromEntries(chipIds.map((chip) => [chip, 'wormhole_b0'])),
                    chip_unique_ids: Object.fromEntries(chipIds.map((chip) => [chip, String(chip)])),
                    chips_with_mmio: [{ 0: 0 }],
                    ethernet_connections: connections,
                    ...(slots ? { asic_locations: Object.fromEntries(chipIds.map((c) => [c, (c % 8) + 1])) } : {}),
                },
                meshChips: mesh ? Object.fromEntries(chipIds.map((c) => [c, [c, 0, 0, 0]])) : {},
            },
        ],
        intraHostLinks: connections.map(([a, b]) => ({ rank: 0, a, b })),
        interHostLinks: [],
    } as unknown as ClusterTopology;
};

// The issue's UBB: four groups of eight joined in a ring by same-slot links, two channels
// each, plus the links between neighbours inside each group.
const UBB_LINKS: [number, number, number][] = [
    ...Array.from({ length: 32 }, (_, c): [number, number, number] => [c, (c + 8) % 32, 2]),
    ...Array.from({ length: 32 }, (_, c) => c).flatMap((c): [number, number, number][] => [
        ...(c % 4 !== 3 ? [[c, c + 1, 1] as [number, number, number]] : []),
        ...(c % 8 < 4 ? [[c, c + 4, 1] as [number, number, number]] : []),
    ]),
];

/** Two slotted 16-chip hosts, each with its own same-slot links, and one link between them. */
const twoHostTopology = ({ ringChannels = 1, crossHostChannels = 1 } = {}): ClusterTopology => {
    const hosts = [0, 1].map((rank) => {
        const chipIds = Array.from({ length: 16 }, (_, chip) => chip);
        return {
            rank,
            descriptor: {
                arch: Object.fromEntries(chipIds.map((chip) => [chip, 'wormhole_b0'])),
                chip_unique_ids: Object.fromEntries(chipIds.map((chip) => [chip, String(rank * 100 + chip)])),
                chips_with_mmio: [{ 0: 0 }],
                ethernet_connections: [],
                asic_locations: Object.fromEntries(chipIds.map((c) => [c, (c % 8) + 1])),
            },
            meshChips: {},
        };
    });
    return {
        isMultiHost: true,
        worldSize: 2,
        unresolvedRemoteCount: 0,
        hosts,
        intraHostLinks: [0, 1].flatMap((rank) =>
            Array.from({ length: 8 }, (_, chip) => chip).flatMap((chip) =>
                Array.from({ length: ringChannels }, (_, chan) => ({
                    rank,
                    a: { chip, chan },
                    b: { chip: chip + 8, chan },
                })),
            ),
        ),
        interHostLinks: Array.from({ length: crossHostChannels }, (_, i) => ({
            a: { rank: 0, chip: 0, chan: ringChannels + i, chipUniqueId: '0' },
            b: { rank: 1, chip: 0, chan: ringChannels + i, chipUniqueId: '100' },
        })),
    } as unknown as ClusterTopology;
};

interface Rect {
    id: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** `<rank>-<chip id>`, so chips stay distinct across hosts. */
const chipIdOf = (cell: Element) =>
    `${cell.getAttribute('data-rank')}-${cell.querySelector('.chip-id')!.textContent!.replace('Device ', '').trim()}`;

/** Chip boxes in link-layer pixels, from their grid cells and rendered size. */
const chipRects = (): Rect[] =>
    [...document.querySelectorAll<HTMLElement>('.chip')].map((cell) => {
        const size = parseFloat(cell.style.width);
        const stride = size + CHIP_GAP;
        const left = (Number(cell.style.gridColumn) - 1) * stride;
        const top = (Number(cell.style.gridRow) - 1) * stride;
        return { id: chipIdOf(cell), left, top, right: left + size, bottom: top + size };
    });

/** All numbers in a path's `d`, in order. */
const pathNumbers = (element: Element) => (element.getAttribute('d')?.match(/-?[\d.]+/g) ?? []).map(Number);

/** Points along a link, sampling curves finely enough to catch a pass over a chip. */
const pointsOf = (element: Element): [number, number][] => {
    if (element.tagName === 'line') {
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((name) => Number(element.getAttribute(name)));
        return Array.from({ length: 41 }, (_, i) => [x1 + ((x2 - x1) * i) / 40, y1 + ((y2 - y1) * i) / 40]);
    }
    const numbers = pathNumbers(element);
    if (element.getAttribute('d')!.includes('C')) {
        const [x0, y0, x1, y1, x2, y2, x3, y3] = numbers;
        return Array.from({ length: 81 }, (_, i) => {
            const t = i / 80;
            const u = 1 - t;
            return [
                u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
                u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3,
            ];
        });
    }
    const vertices: [number, number][] = [];
    for (let i = 0; i < numbers.length; i += 2) {
        vertices.push([numbers[i], numbers[i + 1]]);
    }
    return vertices.flatMap(([x1, y1], i) => {
        const next = vertices[i + 1];
        if (!next) {
            return [[x1, y1] as [number, number]];
        }
        return Array.from({ length: 40 }, (_, step): [number, number] => [
            x1 + ((next[0] - x1) * step) / 40,
            y1 + ((next[1] - y1) * step) / 40,
        ]);
    });
};

const INSET = 4;
const contains = (rect: Rect, [x, y]: [number, number], inset = 0) =>
    x > rect.left + inset && x < rect.right - inset && y > rect.top + inset && y < rect.bottom - inset;

/** For each drawn link, its two end chips and any other chip it passes over. */
const linkCrossings = () => {
    const rects = chipRects();
    return [...document.querySelectorAll('.cluster-link')].map((element) => {
        const points = pointsOf(element);
        const ends = [points[0], points[points.length - 1]].map(
            (point) => rects.find((rect) => contains(rect, point, -1))?.id,
        );
        const crossed = rects
            .filter((rect) => !ends.includes(rect.id))
            .filter((rect) => points.some((point) => contains(rect, point, INSET)))
            .map((rect) => rect.id);
        return { element, points, ends, crossed };
    });
};

type Crossing = ReturnType<typeof linkCrossings>[number];

/** The one drawn link whose ends are these two chips. */
const linkBetween = (crossings: Crossing[], first: string, second: string) =>
    crossings.find(({ ends }) => ends.includes(first) && ends.includes(second))!;

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    topologyOverride = null;
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('cluster link routing', () => {
    it('draws no link over a chip that is not one of its ends', () => {
        topologyOverride = topologyOf({ chipCount: 32, links: UBB_LINKS, slots: true });
        render(<ClusterRenderer />);

        const crossings = linkCrossings();
        expect(crossings).toHaveLength(UBB_LINKS.reduce((sum, [, , channels]) => sum + channels, 0));
        expect(
            crossings.filter(({ crossed }) => crossed.length > 0).map(({ ends, crossed }) => ({ ends, crossed })),
        ).toEqual([]);
        expect(document.querySelectorAll('.is-unrouted')).toHaveLength(0);
    });

    it('highlights only the hovered chip’s links, none of them over another chip', () => {
        topologyOverride = topologyOf({ chipCount: 32, links: UBB_LINKS, slots: true });
        render(<ClusterRenderer />);

        const chipNine = [...document.querySelectorAll('.chip')].find((cell) => chipIdOf(cell) === '0-9')!;
        fireEvent.mouseEnter(chipNine);

        const highlighted = linkCrossings().filter(({ element }) => element.classList.contains('is-highlighted'));
        // Ring links to chips 1 and 17 (two channels each), neighbours 8, 10 and 13.
        expect(highlighted).toHaveLength(7);
        highlighted.forEach(({ ends, crossed }) => {
            expect(ends).toContain('0-9');
            expect(crossed).toEqual([]);
        });
    });

    it('keeps the outside lanes within the stage margin, and few enough to fit', () => {
        topologyOverride = topologyOf({ chipCount: 32, links: UBB_LINKS, slots: true });
        render(<ClusterRenderer />);

        const contentWidth = parseFloat(document.querySelector<HTMLElement>('.cluster')!.style.width);
        // Zoom stays at 1: the stubbed ResizeObserver never reports a container size.
        const margin =
            (parseFloat(document.querySelector<HTMLElement>('.cluster-stage')!.style.width) - contentWidth) / 2;
        const xs = linkCrossings().flatMap(({ points }) => points.map(([x]) => x));

        expect(margin).toBeGreaterThan(0);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(-margin);
        expect(Math.max(...xs)).toBeLessThanOrEqual(contentWidth + margin);
        // A lane is the x of a vertical run left of the grid; a link has one each.
        const leftLanes = new Set(
            [...document.querySelectorAll('path.cluster-link')].flatMap((path) =>
                pathNumbers(path).filter((x, i) => i % 2 === 0 && x < 0),
            ),
        );
        // One lane per link would need 32; sharing lanes between spans that do not meet needs 20.
        expect(leftLanes.size).toBeGreaterThan(0);
        expect(leftLanes.size).toBeLessThanOrEqual(20);
    });

    it('leaves mesh layouts on their curves, with no stage margin', () => {
        topologyOverride = topologyOf({ chipCount: 32, links: UBB_LINKS, slots: true, mesh: true });
        render(<ClusterRenderer />);

        const spanning = [...document.querySelectorAll('path.cluster-link')];
        expect(spanning.length).toBeGreaterThan(0);
        spanning.forEach((path) => expect(path.getAttribute('d')).toContain('C'));
        expect(document.querySelector<HTMLElement>('.cluster')!.style.marginLeft).toBe('0px');
        expect(document.querySelectorAll('.is-unrouted')).toHaveLength(0);
    });

    it('marks a link it cannot route, and still routes its neighbours', () => {
        // Id-order tiling, three rows: the middle row has no blank row beside it.
        topologyOverride = topologyOf({
            chipCount: 12,
            links: [
                [4, 6, 1],
                [1, 9, 1],
            ],
        });
        render(<ClusterRenderer />);
        const crossings = linkCrossings();

        expect(linkBetween(crossings, '0-4', '0-6').element.classList.contains('is-unrouted')).toBe(true);
        expect(linkBetween(crossings, '0-4', '0-6').element.getAttribute('d')).toContain('C');
        // 1 -> 9 leaves through the top pad and the trailing row added for it.
        expect(linkBetween(crossings, '0-1', '0-9').element.classList.contains('is-unrouted')).toBe(false);
        expect(linkBetween(crossings, '0-1', '0-9').crossed).toEqual([]);
        // Two pad rows, three chip rows and the trailing row. Without that row the route
        // would still cross nothing, just below the grid, so the height is what pins it.
        const cluster = document.querySelector<HTMLElement>('.cluster')!;
        const size = parseFloat(document.querySelector<HTMLElement>('.chip')!.style.width);
        expect(parseFloat(cluster.style.height)).toBe(6 * size + 5 * CHIP_GAP);
    });

    it('leaves a diagonal link on its old curve, unmarked', () => {
        // The router handles one row or one column; a diagonal was never offered a route,
        // so it is drawn as it was before #1951 rather than flagged as a failure.
        topologyOverride = topologyOf({ chipCount: 12, links: [[0, 5, 1]] });
        render(<ClusterRenderer />);

        const [diagonal] = [...document.querySelectorAll('.cluster-link')];
        expect(diagonal.getAttribute('d')).toContain('C');
        expect(diagonal.classList.contains('is-unrouted')).toBe(false);
    });

    it('keeps every port on its chip when one edge is asked for more than it holds', () => {
        // Six channels between two chips of the boxed-in middle row. Chip 4's only open edge
        // is LEFT, and chip 6 has none; without the per-edge cap the fifth and sixth ports
        // land on the corner cell and then off the chip.
        topologyOverride = topologyOf({ chipCount: 12, links: [[4, 6, 6]] });
        render(<ClusterRenderer />);

        const rects = chipRects();
        const crossings = linkCrossings();
        expect(crossings).toHaveLength(6);
        (['0-4', '0-6'] as const).forEach((chipId) => {
            const rect = rects.find(({ id }) => id === chipId)!;
            const ends = crossings.map(({ points, ends: found }) =>
                found[0] === chipId ? points[0] : points[points.length - 1],
            );
            ends.forEach((point) => expect(contains(rect, point, -1)).toBe(true));
            expect(new Set(ends.map(([x, y]) => `${x},${y}`)).size).toBe(6);
        });
    });

    // Each link's two ports must land on the two chips it joins, and no two ports may share a
    // spot. A port pushed past its edge's slots can fall into the gap or onto the next chip
    // down, so checking only "inside some chip" would not catch it.
    const expectPortsOnTheirChips = (expectedPairs: string[][]) => {
        const crossings = linkCrossings();
        const endpoints = crossings.flatMap(({ points }) => [points[0], points[points.length - 1]]);
        crossings.forEach(({ ends }) => {
            expect(expectedPairs.some((pair) => pair.every((chip) => ends.includes(chip)))).toBe(true);
        });
        expect(new Set(endpoints.map(([x, y]) => `${x},${y}`)).size).toBe(endpoints.length);
    };

    it('keeps routed and unrouted ports sharing an edge within its slots', () => {
        // Chip 8's routed links to chips 0 and 16 fill its LEFT edge (two channels each); the
        // diagonal to chip 25 is never routed and pass 2 would have picked LEFT too.
        topologyOverride = topologyOf({
            chipCount: 32,
            links: [
                [8, 0, 2],
                [8, 16, 2],
                [8, 25, 2],
            ],
            slots: true,
        });
        render(<ClusterRenderer />);

        expect(linkCrossings()).toHaveLength(6);
        expectPortsOnTheirChips([
            ['0-8', '0-0'],
            ['0-8', '0-16'],
            ['0-8', '0-25'],
        ]);
    });

    it('keeps cross-host ports off an edge that routed links have filled', () => {
        // Four routed channels from each host's chip 0 to chip 8 fill chip 0's LEFT edge; the
        // cross-host links from chip 0 are placed afterwards and must find another edge.
        topologyOverride = twoHostTopology({ ringChannels: 4, crossHostChannels: 2 });
        render(<ClusterRenderer />);

        expect(linkCrossings()).toHaveLength(2 * 8 * 4 + 2);
        expectPortsOnTheirChips([
            ...[0, 1].flatMap((rank) =>
                Array.from({ length: 8 }, (_, chip) => [`${rank}-${chip}`, `${rank}-${chip + 8}`]),
            ),
            ['0-0', '1-0'],
        ]);
    });

    it('fits the stage, lanes included, to the container', () => {
        vi.stubGlobal('ResizeObserver', ReportingResizeObserver);
        topologyOverride = topologyOf({ chipCount: 32, links: UBB_LINKS, slots: true });
        render(<ClusterRenderer />);

        const stage = document.querySelector<HTMLElement>('.cluster-stage')!;
        const cluster = document.querySelector<HTMLElement>('.cluster')!;
        const zoom = Number(/scale\(([\d.]+)\)/.exec(cluster.style.transform)![1]);
        const stageWidth = parseFloat(stage.style.width);
        const marginLeft = parseFloat(cluster.style.marginLeft);

        expect(zoom).toBeLessThan(1);
        expect(stageWidth).toBeCloseTo(REPORTED_WIDTH, 5);
        expect(marginLeft).toBeGreaterThan(0);
        // The stage is the scaled grid plus a scaled margin either side.
        expect(stageWidth - 2 * marginLeft).toBeCloseTo(parseFloat(cluster.style.width) * zoom, 5);
        const leftmost = Math.min(...linkCrossings().flatMap(({ points }) => points.map(([x]) => x)));
        expect(leftmost * zoom).toBeGreaterThanOrEqual(-marginLeft);
    });

    it('routes each host’s own links on a multi-host layout and leaves cross-host links curved', () => {
        topologyOverride = twoHostTopology();
        render(<ClusterRenderer />);

        const crossings = linkCrossings();
        const intraHost = crossings.filter(({ element }) => !element.classList.contains('is-inter-host'));
        const interHost = crossings.filter(({ element }) => element.classList.contains('is-inter-host'));

        expect(intraHost).toHaveLength(16);
        intraHost.forEach(({ crossed }) => expect(crossed).toEqual([]));
        expect(interHost).toHaveLength(1);
        expect(interHost[0].element.getAttribute('d')).toContain('C');
        expect(interHost[0].element.classList.contains('is-unrouted')).toBe(false);
    });
});
