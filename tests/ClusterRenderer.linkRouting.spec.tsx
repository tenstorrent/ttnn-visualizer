// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterRenderer from '../src/components/cluster/ClusterRenderer';
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

interface Rect {
    id: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Chip boxes in link-layer pixels, from their grid cells and rendered size. */
const chipRects = (): Rect[] =>
    [...document.querySelectorAll<HTMLElement>('.chip')].map((cell) => {
        const size = parseFloat(cell.style.width);
        const stride = size + 5;
        const left = (Number(cell.style.gridColumn) - 1) * stride;
        const top = (Number(cell.style.gridRow) - 1) * stride;
        const id = cell.querySelector('.chip-id')!.textContent!.replace('Device ', '').trim();
        return { id, left, top, right: left + size, bottom: top + size };
    });

/** Points along a link, sampling curves finely enough to catch a pass over a chip. */
const pointsOf = (element: Element): [number, number][] => {
    if (element.tagName === 'line') {
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((name) => Number(element.getAttribute(name)));
        return Array.from({ length: 41 }, (_, i) => [x1 + ((x2 - x1) * i) / 40, y1 + ((y2 - y1) * i) / 40]);
    }
    const d = element.getAttribute('d')!;
    const numbers = (d.match(/-?[\d.]+/g) ?? []).map(Number);
    if (d.includes('C')) {
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

        const chipNine = [...document.querySelectorAll('.chip')].find(
            (cell) => cell.querySelector('.chip-id')?.textContent?.replace('Device ', '').trim() === '9',
        )!;
        fireEvent.mouseEnter(chipNine);

        const highlighted = linkCrossings().filter(({ element }) => element.classList.contains('is-highlighted'));
        // Ring links to chips 1 and 17 (two channels each), neighbours 8, 10 and 13.
        expect(highlighted).toHaveLength(7);
        highlighted.forEach(({ ends, crossed }) => {
            expect(ends).toContain('9');
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
            [...document.querySelectorAll('path.cluster-link')].flatMap((path) => {
                const numbers = (path.getAttribute('d')!.match(/-?[\d.]+/g) ?? []).map(Number);
                return numbers.filter((x, i) => i % 2 === 0 && x < 0);
            }),
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

        const [boxedIn, routed] = linkCrossings().sort((a, b) => Number(a.ends[0]) - Number(b.ends[0]) || 0);
        const byEnds = (ends: string[]) =>
            [boxedIn, routed].find(({ ends: found }) => ends.every((e) => found.includes(e)))!;

        expect(byEnds(['4', '6']).element.classList.contains('is-unrouted')).toBe(true);
        expect(byEnds(['4', '6']).element.getAttribute('d')).toContain('C');
        // 1 -> 9 leaves through the top pad and the trailing row added for it.
        expect(byEnds(['1', '9']).element.classList.contains('is-unrouted')).toBe(false);
        expect(byEnds(['1', '9']).crossed).toEqual([]);
    });
});
