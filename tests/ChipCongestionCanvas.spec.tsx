// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChipCongestionCanvas from '../src/components/npe/ChipCongestionCanvas';
import { EVENT_TYPE_FILTER, LinkUtilization, NoCID, NoCType } from '../src/model/NPEModel';
import { NODE_SIZE } from '../src/components/npe/drawingApi';

// The per-chip congestion layer is a canvas, so clicks and hover are resolved by
// hit-testing rather than by DOM targets. #1803
const GAP = 1;
const CELL_STRIDE = NODE_SIZE + GAP;
const GRID = 4;
const CSS_WIDTH = GRID * CELL_STRIDE - GAP;
const CSS_HEIGHT = GRID * CELL_STRIDE - GAP;

// Real NoCID values so the arrow geometry and rotation actually get exercised —
// a bare 'NOC0' falls through `getLinkPoints`' default branch to all-zero points.
// [chip, y, x, nocId, demand, fabricScope]
const makeLink = (y: number, x: number, nocId: NoCID = NoCID.NOC0_EAST, demand = 50): LinkUtilization =>
    [0, y, x, nocId, demand, undefined] as unknown as LinkUtilization;

type SelectLink = (linkUtilization: LinkUtilization, index: number) => void;
type ClearSelection = () => void;

let onSelectLink: Mock<SelectLink>;
let onClearSelection: Mock<ClearSelection>;

// The component derives its raster scale by measuring itself, so the on-screen box
// is what drives both the backing store and hit-testing. jsdom reports a zero-sized
// rect, so stub the prototype before render.
const stubOnScreenScale = (onScreenScale: number) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: CSS_WIDTH * onScreenScale,
        height: CSS_HEIGHT * onScreenScale,
        right: CSS_WIDTH * onScreenScale,
        bottom: CSS_HEIGHT * onScreenScale,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    } as DOMRect);
};

const props = (links: LinkUtilization[], nocFilter: NoCType | null = null) => ({
    links: links.map((linkUtilization, index) => ({ linkUtilization, index })),
    gridWidth: GRID,
    gridHeight: GRID,
    isFabricMode: false,
    altCongestionColors: false,
    nocFilter,
    fabricEventsFilter: EVENT_TYPE_FILTER.ALL_EVENTS,
    dimmed: false,
    onSelectLink,
    onClearSelection,
});

const renderCanvas = (links: LinkUtilization[], nocFilter: NoCType | null = null, onScreenScale = 1) => {
    stubOnScreenScale(onScreenScale);
    const result = render(<ChipCongestionCanvas {...props(links, nocFilter)} />);
    return {
        ...result,
        canvas: document.querySelector('.congestion-canvas') as HTMLCanvasElement,
        hover: document.querySelector('.congestion-hover') as HTMLDivElement,
    };
};

// Centre of the given grid cell, in the canvas's on-screen pixel space.
const cellCentre = (x: number, y: number, onScreenScale = 1) => ({
    clientX: (x * CELL_STRIDE + NODE_SIZE / 2) * onScreenScale,
    clientY: (y * CELL_STRIDE + NODE_SIZE / 2) * onScreenScale,
});

beforeEach(() => {
    onSelectLink = vi.fn<SelectLink>();
    onClearSelection = vi.fn<ClearSelection>();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ChipCongestionCanvas hit-testing', () => {
    it('selects the link occupying the clicked cell', () => {
        const link = makeLink(2, 1);
        const { canvas } = renderCanvas([link]);

        fireEvent.click(canvas, cellCentre(1, 2));

        expect(onSelectLink).toHaveBeenCalledWith(link, 0);
        expect(onClearSelection).not.toHaveBeenCalled();
    });

    it('clears the selection when a cell with no link is clicked', () => {
        const { canvas } = renderCanvas([makeLink(2, 1)]);

        fireEvent.click(canvas, cellCentre(3, 3));

        expect(onClearSelection).toHaveBeenCalled();
        expect(onSelectLink).not.toHaveBeenCalled();
    });

    it('resolves the topmost link when several stack on one cell', () => {
        // Last painted wins, matching the old grid where the last-mounted tile
        // caught the click.
        const under = makeLink(0, 0, NoCID.NOC0_EAST);
        const over = makeLink(0, 0, NoCID.NOC1_NORTH);
        const { canvas } = renderCanvas([under, over]);

        fireEvent.click(canvas, cellCentre(0, 0));

        expect(onSelectLink).toHaveBeenCalledWith(over, 1);
    });

    it('ignores a link filtered out by the active NOC filter', () => {
        const { canvas } = renderCanvas([makeLink(1, 1, NoCID.NOC0_EAST)], NoCType.NOC1);

        fireEvent.click(canvas, cellCentre(1, 1));

        expect(onSelectLink).not.toHaveBeenCalled();
        expect(onClearSelection).toHaveBeenCalled();
    });

    it('maps the pointer back into tile space when the cluster is scaled', () => {
        // The cluster is scaled with CSS zoom, so a click at cell (1,2) arrives at
        // twice the coordinates. Getting this wrong selects the wrong link.
        const link = makeLink(2, 1);
        const { canvas } = renderCanvas([link], null, 2);

        fireEvent.click(canvas, cellCentre(1, 2, 2));

        expect(onSelectLink).toHaveBeenCalledWith(link, 0);
    });
});

describe('ChipCongestionCanvas hover marker', () => {
    it('is hidden until the pointer is over a cell carrying a link', () => {
        const { canvas, hover } = renderCanvas([makeLink(1, 1)]);
        expect(hover.style.display).toBe('none');

        fireEvent.mouseMove(canvas, cellCentre(3, 3));
        expect(hover.style.display).toBe('none');
    });

    it('moves to the hovered link cell', () => {
        const { canvas, hover } = renderCanvas([makeLink(1, 2)]);

        fireEvent.mouseMove(canvas, cellCentre(2, 1));

        expect(hover.style.display).toBe('block');
        expect(hover.style.transform).toBe(`translate(${2 * CELL_STRIDE}px, ${1 * CELL_STRIDE}px)`);
    });

    it('hides again when the pointer leaves the canvas', () => {
        const { canvas, hover } = renderCanvas([makeLink(0, 0)]);
        fireEvent.mouseMove(canvas, cellCentre(0, 0));
        expect(hover.style.display).toBe('block');

        fireEvent.mouseLeave(canvas);

        expect(hover.style.display).toBe('none');
    });

    it('drops the marker when a scrub takes the link out from under a still pointer', () => {
        const { canvas, hover, rerender } = renderCanvas([makeLink(0, 0)]);
        fireEvent.mouseMove(canvas, cellCentre(0, 0));
        expect(hover.style.display).toBe('block');

        // Same pointer position, new timestep in which that cell has no link.
        rerender(<ChipCongestionCanvas {...props([makeLink(3, 3)])} />);

        expect(hover.style.display).toBe('none');
    });

    it('shows the marker when a scrub brings a link under a still pointer', () => {
        const { canvas, hover, rerender } = renderCanvas([makeLink(3, 3)]);
        fireEvent.mouseMove(canvas, cellCentre(0, 0));
        expect(hover.style.display).toBe('none');

        rerender(<ChipCongestionCanvas {...props([makeLink(0, 0)])} />);

        expect(hover.style.display).toBe('block');
    });
});

describe('ChipCongestionCanvas backing store', () => {
    it('rasterises at device-pixel resolution', () => {
        Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
        const { canvas } = renderCanvas([makeLink(1, 1)]);

        expect(canvas.width).toBe(CSS_WIDTH * 2);
        expect(canvas.height).toBe(CSS_HEIGHT * 2);
    });

    it('caps the scale so zooming cannot grow the buffer without bound', () => {
        // dpr 2 × zoom 2 would ask for a 4× linear (16× area) buffer — hundreds of
        // MB across an 8-chip cluster, past where the browser discards buffers and
        // chips render blank. The cap also means zooming past it stops reallocating.
        Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
        const { canvas } = renderCanvas([makeLink(1, 1)], null, 2);

        expect(canvas.width).toBe(CSS_WIDTH * 2);
        expect(canvas.height).toBe(CSS_HEIGHT * 2);
    });

    it('keeps the CSS box in pre-scale tile units', () => {
        Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
        const { canvas } = renderCanvas([makeLink(1, 1)]);

        expect(canvas.style.width).toBe(`${CSS_WIDTH}px`);
        expect(canvas.style.height).toBe(`${CSS_HEIGHT}px`);
    });
});
