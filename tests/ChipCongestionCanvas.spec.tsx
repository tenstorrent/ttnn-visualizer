// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChipCongestionCanvas from '../src/components/npe/ChipCongestionCanvas';
import { EVENT_TYPE_FILTER, LinkUtilization, NoCType } from '../src/model/NPEModel';
import { NODE_SIZE } from '../src/components/npe/drawingApi';

// The per-chip congestion layer is a canvas, so clicks are resolved by hit-testing
// rather than by DOM targets. #1803
const GAP = 1;
const CELL_STRIDE = NODE_SIZE + GAP;
const GRID = 4;

// [chip, y, x, nocId, demand, fabricScope]
const makeLink = (y: number, x: number, nocId: string, demand = 0.5): LinkUtilization =>
    [0, y, x, nocId, demand, undefined] as unknown as LinkUtilization;

type SelectLink = (linkUtilization: LinkUtilization, index: number) => void;
type ClearSelection = () => void;

const renderCanvas = (
    links: LinkUtilization[],
    handlers: { onSelectLink: SelectLink; onClearSelection: ClearSelection },
    nocFilter: NoCType | null = null,
) => {
    const result = render(
        <ChipCongestionCanvas
            links={links.map((linkUtilization, index) => ({ linkUtilization, index }))}
            gridWidth={GRID}
            gridHeight={GRID}
            isFabricMode={false}
            altCongestionColors={false}
            nocFilter={nocFilter}
            fabricEventsFilter={EVENT_TYPE_FILTER.ALL_EVENTS}
            dimmed={false}
            zoom={1}
            onSelectLink={handlers.onSelectLink}
            onClearSelection={handlers.onClearSelection}
        />,
    );
    // The base canvas carries the pointer handlers; the hover overlay is inert.
    const canvas = document.querySelector('.congestion-canvas') as HTMLCanvasElement;
    const cssWidth = GRID * CELL_STRIDE - GAP;
    const cssHeight = GRID * CELL_STRIDE - GAP;
    // Hit-testing scales the pointer offset by the element's on-screen box, which
    // jsdom reports as zero — stub it to the canvas's own CSS size.
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: cssWidth,
        height: cssHeight,
        right: cssWidth,
        bottom: cssHeight,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    } as DOMRect);
    return { ...result, canvas };
};

// Centre of the given grid cell, in the canvas's CSS pixel space.
const cellCentre = (x: number, y: number) => ({
    clientX: x * CELL_STRIDE + NODE_SIZE / 2,
    clientY: y * CELL_STRIDE + NODE_SIZE / 2,
});

let onSelectLink: Mock<SelectLink>;
let onClearSelection: Mock<ClearSelection>;

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
        const link = makeLink(2, 1, 'NOC0');
        const { canvas } = renderCanvas([link], { onSelectLink, onClearSelection });

        canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, ...cellCentre(1, 2) }));

        expect(onSelectLink).toHaveBeenCalledWith(link, 0);
        expect(onClearSelection).not.toHaveBeenCalled();
    });

    it('clears the selection when a cell with no link is clicked', () => {
        const { canvas } = renderCanvas([makeLink(2, 1, 'NOC0')], { onSelectLink, onClearSelection });

        canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, ...cellCentre(3, 3) }));

        expect(onClearSelection).toHaveBeenCalled();
        expect(onSelectLink).not.toHaveBeenCalled();
    });

    it('resolves the topmost link when several stack on one cell', () => {
        // Last drawn wins, matching the old grid where the last-mounted tile caught
        // the click.
        const under = makeLink(0, 0, 'NOC0');
        const over = makeLink(0, 0, 'NOC1');
        const { canvas } = renderCanvas([under, over], { onSelectLink, onClearSelection });

        canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, ...cellCentre(0, 0) }));

        expect(onSelectLink).toHaveBeenCalledWith(over, 1);
    });

    it('ignores a link filtered out by the active NOC filter', () => {
        const { canvas } = renderCanvas([makeLink(1, 1, 'NOC0')], { onSelectLink, onClearSelection }, NoCType.NOC1);

        canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, ...cellCentre(1, 1) }));

        expect(onSelectLink).not.toHaveBeenCalled();
        expect(onClearSelection).toHaveBeenCalled();
    });
});

describe('ChipCongestionCanvas backing store', () => {
    it('does not resize the backing store when a redraw keeps the same geometry', () => {
        // Assigning width/height reallocates and zeroes the buffer (~2.8 MB per chip
        // at dpr 2) and forces a GPU re-upload, so a same-size redraw must not.
        const { canvas, rerender } = renderCanvas([makeLink(1, 1, 'NOC0')], { onSelectLink, onClearSelection });
        const widthSpy = vi.fn();
        Object.defineProperty(canvas, 'width', {
            get: () => GRID * CELL_STRIDE - GAP,
            set: widthSpy,
            configurable: true,
        });

        rerender(
            <ChipCongestionCanvas
                links={[{ linkUtilization: makeLink(1, 1, 'NOC0'), index: 0 }]}
                gridWidth={GRID}
                gridHeight={GRID}
                isFabricMode={false}
                altCongestionColors={false}
                nocFilter={null}
                fabricEventsFilter={EVENT_TYPE_FILTER.ALL_EVENTS}
                dimmed
                zoom={1}
                onSelectLink={onSelectLink}
                onClearSelection={onClearSelection}
            />,
        );

        expect(widthSpy).not.toHaveBeenCalled();
    });
});
