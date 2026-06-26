// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CircularBufferPressureModal from '../src/components/operation-details/CircularBufferPressureModal';
import { CBPressureSnapshot } from '../src/functions/processMemoryAllocations';
import { TestProviders } from './helpers/TestProviders';

// useDevices is the only API hook this modal touches; stub it so we don't
// need a backing query/router setup just to feed grid dimensions.
const mockUseDevices = vi.fn();
vi.mock('../src/hooks/useAPI.tsx', () => ({
    useDevices: () => mockUseDevices(),
}));

// Tiny 2x2 grid keeps the DOM small and makes coverage-vs-bytes assertions
// trivial to read at the test site.
const DEVICE_2X2 = {
    num_x_cores: 2,
    num_y_cores: 2,
    worker_l1_size: 1_000_000,
};

const ON_CLOSE = vi.fn();

function renderModal(snapshot: CBPressureSnapshot | null, title = 'demo_op · per-core CB allocations') {
    return render(
        <TestProviders>
            <CircularBufferPressureModal
                isOpen
                onClose={ON_CLOSE}
                title={title}
                snapshot={snapshot}
            />
        </TestProviders>,
    );
}

function getTensix(x: number, y: number): HTMLButtonElement {
    // Cell label is "x,y" inside the .coord span; grab the enclosing button.
    const coord = screen.getByText(`${x},${y}`);
    const tensix = coord.closest('button.tensix');
    if (!tensix) {
        throw new Error(`Could not find tensix button for (${x}, ${y})`);
    }
    return tensix as HTMLButtonElement;
}

beforeEach(() => {
    mockUseDevices.mockReturnValue({ data: [DEVICE_2X2] });
    ON_CLOSE.mockReset();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('CircularBufferPressureModal - lifecycle', () => {
    it('renders nothing when isOpen is false', () => {
        render(
            <TestProviders>
                <CircularBufferPressureModal
                    isOpen={false}
                    onClose={ON_CLOSE}
                    title='hidden'
                    snapshot={null}
                />
            </TestProviders>,
        );

        expect(screen.queryByText('hidden')).not.toBeInTheDocument();
        expect(screen.queryByText(/Peak:/i)).not.toBeInTheDocument();
    });

    it('shows the loading container when devices are still pending', () => {
        mockUseDevices.mockReturnValue({ data: undefined });

        renderModal(buildSnapshot());

        // Body never renders without devices; check by absence of the Peak tag
        // and presence of the spinner container.
        expect(screen.queryByText(/Peak:/i)).not.toBeInTheDocument();
        expect(document.querySelector('.loading-container')).toBeInTheDocument();
    });

    it('shows the loading container when the snapshot is still null', () => {
        renderModal(null, 'pending op');

        expect(screen.queryByText('pending op')).not.toBeInTheDocument();
        expect(document.querySelector('.loading-container')).toBeInTheDocument();
    });

    it('returns null (no portal) when devices payload is empty', () => {
        mockUseDevices.mockReturnValue({ data: [] });

        renderModal(buildSnapshot(), 'should not render');

        expect(screen.queryByText('should not render')).not.toBeInTheDocument();
        expect(document.querySelector('.loading-container')).not.toBeInTheDocument();
    });
});

describe('CircularBufferPressureModal - header summary', () => {
    it('renders title, Peak, L1 budget, and CB count tags', () => {
        renderModal(buildSnapshot());

        expect(screen.getByText('demo_op · per-core CB allocations')).toBeInTheDocument();
        expect(screen.getByText(/^Peak:/)).toBeInTheDocument();
        expect(screen.getByText(/^L1 budget:/)).toBeInTheDocument();
        expect(screen.getByText(/^CBs:\s*2$/)).toBeInTheDocument();
    });

    it('hides the unattributed tag when no "?" bytes are present', () => {
        renderModal(buildSnapshot({ unattributedBytes: 0 }));

        expect(screen.queryByText(/^Unattributed:/)).not.toBeInTheDocument();
    });

    it('renders the unattributed tag when "?" bytes exist', () => {
        renderModal(
            buildSnapshot({
                unattributedBytes: 4096,
                // Mirror the data layer: the "?" bucket lives in byCore but
                // not in maxBytes.
                byCore: { '0,0': 2048, '?': 4096 },
            }),
        );

        expect(screen.getByText(/^Unattributed:/)).toBeInTheDocument();
    });
});

describe('CircularBufferPressureModal - heatmap grid', () => {
    it('renders one tensix button per worker core', () => {
        renderModal(buildSnapshot());

        // 2x2 = 4 cells.
        const cells = document.querySelectorAll('button.tensix');
        expect(cells).toHaveLength(4);
        expect(screen.getByText('0,0')).toBeInTheDocument();
        expect(screen.getByText('1,1')).toBeInTheDocument();
    });

    it('marks only cores with bytes as has-bytes', () => {
        renderModal(buildSnapshot());

        expect(getTensix(0, 0)).toHaveClass('has-bytes');
        expect(getTensix(1, 0)).toHaveClass('has-bytes');
        // (0,1) and (1,1) have zero bytes in the fixture.
        expect(getTensix(0, 1)).not.toHaveClass('has-bytes');
        expect(getTensix(1, 1)).not.toHaveClass('has-bytes');
    });

    it('drives --cb-intensity off snapshot.maxBytes in local normalisation', () => {
        const snapshot = buildSnapshot();
        renderModal(snapshot);

        // Local normalisation: intensity = bytes / maxBytes.
        // (0,0) carries the peak (1MiB) → intensity 1.
        // (1,0) carries 256KiB → intensity 0.25.
        const peakIntensity = getTensix(0, 0).style.getPropertyValue('--cb-intensity');
        const partialIntensity = getTensix(1, 0).style.getPropertyValue('--cb-intensity');
        expect(Number(peakIntensity)).toBeCloseTo(1.0, 3);
        expect(Number(partialIntensity)).toBeCloseTo((256 * 1024) / (1024 * 1024), 3);
    });

    it('rescales --cb-intensity against L1 budget when "vs. L1 budget" is selected', () => {
        renderModal(buildSnapshot());

        fireEvent.click(screen.getByRole('button', { name: 'vs. L1 budget' }));

        // 1 MiB / 1 MB worker_l1_size ≈ 1.048 → clamped to 1.0.
        // 256 KiB / 1 MB ≈ 0.262.
        expect(Number(getTensix(0, 0).style.getPropertyValue('--cb-intensity'))).toBeCloseTo(1, 3);
        expect(Number(getTensix(1, 0).style.getPropertyValue('--cb-intensity'))).toBeCloseTo(
            (256 * 1024) / 1_000_000,
            3,
        );
    });

    it('shows per-cell byte labels when "Show bytes on cells" is enabled', () => {
        renderModal(buildSnapshot());

        // The Switch defaults to checked, so the byte value should already
        // be visible on cells that carry bytes.
        const labels = document.querySelectorAll('button.tensix .tensix-meta .value');
        expect(labels).toHaveLength(2);

        // Toggle it off and the byte labels disappear, but the coordinate
        // labels stay.
        fireEvent.click(screen.getByLabelText('Show bytes on cells'));
        expect(document.querySelectorAll('button.tensix .tensix-meta .value')).toHaveLength(0);
        expect(screen.getByText('0,0')).toBeInTheDocument();
    });
});

describe('CircularBufferPressureModal - selection flows', () => {
    it('opens the zoomed core plot when a cell is clicked and closes it on a second click', () => {
        renderModal(buildSnapshot());

        // No details panel before selection.
        expect(document.querySelector('.tensix-details')).not.toBeInTheDocument();

        fireEvent.click(getTensix(0, 0));

        const details = document.querySelector('.tensix-details');
        expect(details).toBeInTheDocument();
        // Header should announce the selected core.
        expect(within(details as HTMLElement).getByText(/Core \(0,0\)/)).toBeInTheDocument();
        // Default fixture lands one CB on (0,0); the panel uses the singular
        // "CB" form to gate the count-label pluralisation.
        expect(within(details as HTMLElement).getByText(/· 1 CB$/)).toBeInTheDocument();
        // Zoomed plot is rendered as an inline SVG inside the details panel.
        expect((details as HTMLElement).querySelector('.zoomed-core-plot')).not.toBeNull();

        fireEvent.click(getTensix(0, 0));
        expect(document.querySelector('.tensix-details')).not.toBeInTheDocument();
    });

    it('highlights every core covered by a selected CB row', () => {
        renderModal(buildSnapshot());

        // The 1MiB CB on (0,0) is the first CB in the list. Click its row.
        const rows = document.querySelectorAll('button.cb-row');
        expect(rows.length).toBeGreaterThan(0);
        fireEvent.click(rows[0]);

        expect(getTensix(0, 0)).toHaveClass('highlighted');
        // (1,0) carries a different CB so it must NOT be highlighted by this row.
        expect(getTensix(1, 0)).not.toHaveClass('highlighted');
    });

    it('clears core / CB selection when the snapshot prop changes', () => {
        // Stale selections would otherwise leak across DeviceOps because the
        // modal renders null on close instead of unmounting.
        const first = buildSnapshot();
        const { rerender } = render(
            <TestProviders>
                <CircularBufferPressureModal
                    isOpen
                    onClose={ON_CLOSE}
                    title='op A'
                    snapshot={first}
                />
            </TestProviders>,
        );
        fireEvent.click(getTensix(0, 0));
        fireEvent.click(document.querySelectorAll('button.cb-row')[0]);
        expect(document.querySelector('.tensix-details')).toBeInTheDocument();
        expect(getTensix(0, 0)).toHaveClass('highlighted');

        // Swap in a different snapshot - say a single CB on (1,1) - and the
        // previous core/CB selection must drop.
        const second: CBPressureSnapshot = {
            byCore: { '1,1': 2048 },
            maxBytes: 2048,
            unattributedBytes: 0,
            allocations: [
                {
                    nodeId: 99,
                    address: 0x9000,
                    size: 2048,
                    numCores: 1,
                    coreRangeSet: '{[(x=1,y=1) - (x=1,y=1)]}',
                    cores: [{ x: 1, y: 1 }],
                    globallyAllocated: false,
                },
            ],
        };
        rerender(
            <TestProviders>
                <CircularBufferPressureModal
                    isOpen
                    onClose={ON_CLOSE}
                    title='op B'
                    snapshot={second}
                />
            </TestProviders>,
        );

        expect(document.querySelector('.tensix-details')).not.toBeInTheDocument();
        // No cell should carry the highlighted class anymore.
        expect(document.querySelectorAll('button.tensix.highlighted')).toHaveLength(0);
    });
});

describe('CircularBufferPressureModal - legend totals', () => {
    it('hides "Total CBs" when the sum of CB sizes equals the per-core peak', () => {
        // Two CBs on the same core → sum == peak → only "Peak per core" row.
        const cb1 = 1024 * 1024;
        const cb2 = 256 * 1024;
        const snapshot: CBPressureSnapshot = {
            byCore: { '0,0': cb1 + cb2 },
            maxBytes: cb1 + cb2,
            unattributedBytes: 0,
            allocations: [
                {
                    nodeId: 11,
                    address: 0x1000,
                    size: cb1,
                    numCores: 1,
                    coreRangeSet: '{[(x=0,y=0) - (x=0,y=0)]}',
                    cores: [{ x: 0, y: 0 }],
                    globallyAllocated: false,
                },
                {
                    nodeId: 12,
                    address: 0x2000,
                    size: cb2,
                    numCores: 1,
                    coreRangeSet: '{[(x=0,y=0) - (x=0,y=0)]}',
                    cores: [{ x: 0, y: 0 }],
                    globallyAllocated: false,
                },
            ],
        };
        renderModal(snapshot);

        expect(screen.getByText('Peak per core')).toBeInTheDocument();
        expect(screen.queryByText('Total CBs')).not.toBeInTheDocument();
    });

    it('shows "Total CBs" when CBs land on disjoint cores (sum > peak)', () => {
        // The default fixture has cb1 on (0,0) and cb2 on (1,0) — disjoint
        // cores, so sum (1MiB + 256KiB) > peak (1MiB).
        renderModal(buildSnapshot());

        expect(screen.getByText('Peak per core')).toBeInTheDocument();
        expect(screen.getByText('Total CBs')).toBeInTheDocument();
    });

    it('shows the empty-state message when there are no CBs in the snapshot', () => {
        renderModal({
            byCore: {},
            maxBytes: 0,
            unattributedBytes: 0,
            allocations: [],
        });

        expect(screen.getByText(/No live CBs in this DeviceOp\./)).toBeInTheDocument();
        // No totals row when there's nothing to total.
        expect(screen.queryByText('Peak per core')).not.toBeInTheDocument();
    });

    it('does not count aliased CBs toward the "Total CBs" sum (#1651 / Copilot review on #1656)', () => {
        // Regression for the legend-totals interaction with #1651: aliased
        // CBs are intentionally excluded from `snapshot.maxBytes`, so they
        // must also be excluded from `cbSum`. Otherwise `cbSum > maxBytes`
        // fires even when the anonymous CBs share cores, surfacing the
        // tooltip's "disjoint core sets" explanation for the wrong reason.
        const anonymous = 32;
        const aliased = 100_000;
        const snapshot: CBPressureSnapshot = {
            // Anonymous CB lives on (0,0); aliased CB is a view into an
            // upstream tensor and contributes no per-core pressure.
            byCore: { '0,0': anonymous },
            maxBytes: anonymous,
            unattributedBytes: 0,
            allocations: [
                {
                    nodeId: 1,
                    address: 0x1000,
                    size: aliased,
                    numCores: 1,
                    coreRangeSet: '{[(x=0,y=0) - (x=0,y=0)]}',
                    cores: [{ x: 0, y: 0 }],
                    globallyAllocated: true,
                },
                {
                    nodeId: 2,
                    address: 0x2000,
                    size: anonymous,
                    numCores: 1,
                    coreRangeSet: '{[(x=0,y=0) - (x=0,y=0)]}',
                    cores: [{ x: 0, y: 0 }],
                    globallyAllocated: false,
                },
            ],
        };
        renderModal(snapshot);

        // Anonymous CB sum (32 B) == maxBytes (32 B), so "Total CBs" must be
        // hidden. Pre-fix this would have fired because cbSum = 32 + 100_000
        // > maxBytes = 32.
        expect(screen.getByText('Peak per core')).toBeInTheDocument();
        expect(screen.queryByText('Total CBs')).not.toBeInTheDocument();
    });
});

describe('CircularBufferPressureModal - globally_allocated CBs (#1651)', () => {
    it('renders aliased CB rows with the outline-only swatch and Globally allocated marker', () => {
        renderModal(buildAliasedSnapshot());

        const rows = document.querySelectorAll('button.cb-row');
        expect(rows).toHaveLength(2);

        const aliasedRow = rows[0];
        const anonymousRow = rows[1];

        expect(aliasedRow).toHaveClass('aliased');
        expect(anonymousRow).not.toHaveClass('aliased');

        const aliasedSwatch = aliasedRow.querySelector('.swatch');
        const anonymousSwatch = anonymousRow.querySelector('.swatch');
        expect(aliasedSwatch).toHaveClass('swatch-outline');
        expect(anonymousSwatch).not.toHaveClass('swatch-outline');
        // Outline-only swatches drop the fill explicitly so the row reads as
        // "view, not allocation".
        expect((aliasedSwatch as HTMLElement).style.backgroundColor).toBe('transparent');
        expect((anonymousSwatch as HTMLElement).style.backgroundColor).not.toBe('transparent');

        expect(within(aliasedRow as HTMLElement).getByText('Globally allocated')).toBeInTheDocument();
        expect(within(anonymousRow as HTMLElement).queryByText('Globally allocated')).not.toBeInTheDocument();
    });

    it('exposes the aliased-to-tensor address through the row aria-label', () => {
        // Tooltip text on the row itself is hard to assert without hover
        // simulation; the marker's `aria-label` gives us the same semantic
        // payload synchronously and is what assistive tech reads anyway.
        renderModal(buildAliasedSnapshot());

        const marker = document.querySelector('.cb-row.aliased .aliased-marker');
        expect(marker).not.toBeNull();
        expect(marker).toHaveAttribute('aria-label', expect.stringMatching(/Globally allocated.*aliased to tensor/i));
    });

    it('keeps aliased and anonymous CBs in a single list (no section split)', () => {
        // AC explicitly forbids splitting aliased CBs into their own
        // sub-heading; the kernel-side audience expects all CBs interleaved
        // in their natural (address) order.
        renderModal(buildAliasedSnapshot());

        const legend = document.querySelector('.legend .cb-list');
        expect(legend).not.toBeNull();
        const rows = (legend as HTMLElement).querySelectorAll('button.cb-row');
        expect(rows).toHaveLength(2);
        // Only one Circular buffers heading - no "Globally allocated" sub-heading
        // sneaking into the legend layout.
        expect(document.querySelectorAll('.legend h4')).toHaveLength(1);
    });

    it('marks the per-core strip rect for an aliased CB as aliased', () => {
        renderModal(buildAliasedSnapshot());

        // The aliased CB lands on (0,0); its rect should carry the .aliased
        // class so SCSS can render it as outline-only.
        const cellRects = getTensix(0, 0).querySelectorAll('.cb-strip-chunk');
        const aliasedRects = Array.from(cellRects).filter((r) => r.classList.contains('aliased'));
        const filledRects = Array.from(cellRects).filter((r) => !r.classList.contains('aliased'));
        expect(aliasedRects.length).toBeGreaterThan(0);
        // The anonymous CB sits on (1,0), not (0,0), so (0,0) should carry
        // only the aliased rect in this fixture.
        expect(filledRects).toHaveLength(0);
        // Aliased rects render with `fill="none"` so the outline-only treatment
        // applied via SCSS is visible at the SVG layer too.
        expect(aliasedRects[0]).toHaveAttribute('fill', 'none');
    });

    it('opens the zoomed plot with an aliased rect when an aliased-only core is selected', () => {
        renderModal(buildAliasedSnapshot());

        fireEvent.click(getTensix(0, 0));
        const details = document.querySelector('.tensix-details') as HTMLElement | null;
        expect(details).not.toBeNull();

        // Zoomed plot mirrors the strip: aliased CBs render outline-only. Per
        // #1665 the aliased rect uses `fill="transparent"` rather than
        // `fill="none"` so the whole interior is hit-testable under the
        // default `pointer-events: visiblePainted` — without this the only
        // clickable surface is the 1.5px stroke. Visually identical because
        // `transparent` is `rgba(0,0,0,0)`.
        const zoomedChunks = details!.querySelectorAll('.zoomed-chunk');
        const aliasedChunks = Array.from(zoomedChunks).filter((c) => c.classList.contains('aliased'));
        expect(aliasedChunks.length).toBeGreaterThan(0);
        const aliasedRect = aliasedChunks[0].querySelector('.zoomed-chunk-rect');
        expect(aliasedRect).toHaveAttribute('fill', 'transparent');

        // Tooltip <title> for the aliased zoomed chunk surfaces the "aliased
        // to tensor" framing the issue asks for.
        const title = aliasedChunks[0].querySelector('title');
        expect(title?.textContent).toMatch(/Aliased to tensor @/);
        expect(title?.textContent).toMatch(/no new allocation/);
    });
});

describe('CircularBufferPressureModal - show/hide globally allocated CBs (#1655)', () => {
    it('renders the aliased-CB toggle only when the snapshot has aliased CBs', () => {
        // No aliased CBs in the default fixture → the affordance must stay
        // hidden; the existing "Show bytes on cells" toggle is the only
        // Switch in the controls row.
        renderModal(buildSnapshot());
        expect(screen.queryByLabelText('Show globally allocated CBs')).not.toBeInTheDocument();

        cleanup();

        // Aliased fixture has one globally_allocated CB → toggle appears.
        renderModal(buildAliasedSnapshot());
        expect(screen.getByLabelText('Show globally allocated CBs')).toBeInTheDocument();
    });

    it('defaults to on - aliased CBs are visible until the user opts out', () => {
        renderModal(buildAliasedSnapshot());

        const toggle = screen.getByLabelText('Show globally allocated CBs') as HTMLInputElement;
        expect(toggle).toBeChecked();

        // Sanity-check the rendered state matches the toggle: aliased row
        // present in the legend, header CBs count includes both CBs.
        expect(document.querySelectorAll('button.cb-row')).toHaveLength(2);
        expect(screen.getByText(/^CBs:\s*2$/)).toBeInTheDocument();
        // "(N hidden)" hint only renders when something is hidden.
        expect(screen.queryByText(/\(\d+ hidden\)/)).not.toBeInTheDocument();
    });

    it('dims aliased legend rows and filters them from the grid strip + zoomed plot when toggled off', () => {
        renderModal(buildAliasedSnapshot());

        fireEvent.click(screen.getByLabelText('Show globally allocated CBs'));

        // Legend still shows both rows - the right panel is a reference
        // surface, so we don't strip aliased CBs out of it. The aliased
        // row picks up the `aliased-dimmed` class which drives the opacity
        // demotion in SCSS.
        const rows = document.querySelectorAll('button.cb-row');
        expect(rows).toHaveLength(2);
        const aliasedRow = rows[0];
        const anonymousRow = rows[1];
        expect(aliasedRow).toHaveClass('aliased');
        expect(aliasedRow).toHaveClass('aliased-dimmed');
        expect(anonymousRow).not.toHaveClass('aliased-dimmed');
        // The "Globally allocated" marker stays visible on the dimmed row
        // so the reason for the demotion is still legible.
        expect(within(aliasedRow as HTMLElement).getByText('Globally allocated')).toBeInTheDocument();

        // Header CBs count still reflects the full snapshot - the rows are
        // dimmed, not removed.
        expect(screen.getByText(/^CBs:\s*2$/)).toBeInTheDocument();
        // Hint is grid-focused: "hidden" refers to the strip/zoomed plot,
        // not to the legend.
        expect(screen.getByText(/^\(1 hidden\)$/)).toBeInTheDocument();

        // Per-core strip on (0,0) - the aliased-only core in the fixture -
        // no longer has any CB rects to render. (1,0) still has the
        // anonymous CB rect.
        expect(getTensix(0, 0).querySelectorAll('.cb-strip-chunk')).toHaveLength(0);
        expect(getTensix(1, 0).querySelectorAll('.cb-strip-chunk')).toHaveLength(1);

        // Zoomed plot on the aliased-only core renders the empty-state copy
        // (no contributions) instead of the outline-only rect that was there
        // when the toggle was on.
        fireEvent.click(getTensix(0, 0));
        const details = document.querySelector('.tensix-details') as HTMLElement | null;
        expect(details).not.toBeNull();
        expect(within(details!).getByText(/No CB contributions for this core\./)).toBeInTheDocument();
        expect(details!.querySelector('.zoomed-core-plot')).toBeNull();
    });

    it('keeps dimmed aliased rows interactive: clicking still highlights the cores they touch', () => {
        // The dim-but-keep-in-legend trade-off only makes sense if the row
        // is still useful as a reference. The selection lookup uses the
        // full snapshot (not the grid-visible subset) so a dimmed row can
        // still light up its cores even though no strip rect is rendered.
        renderModal(buildAliasedSnapshot());

        fireEvent.click(screen.getByLabelText('Show globally allocated CBs'));

        const aliasedRow = document.querySelector('button.cb-row.aliased-dimmed') as HTMLButtonElement | null;
        expect(aliasedRow).not.toBeNull();
        fireEvent.click(aliasedRow!);

        // Aliased CB in the fixture lives on (0,0) only.
        expect(getTensix(0, 0)).toHaveClass('highlighted');
        expect(getTensix(1, 0)).not.toHaveClass('highlighted');
        // The strip on (0,0) still shows no rects - selection only drives
        // the cell-level highlight, it does NOT re-introduce the filtered
        // strip rect.
        expect(getTensix(0, 0).querySelectorAll('.cb-strip-chunk')).toHaveLength(0);
    });

    it('keeps Peak per core and Total CBs anchored to the anonymous bytes when toggled off', () => {
        // Build a fixture where Total CBs would visibly diverge if we
        // accidentally driven it off the visible set: one anonymous CB on
        // (0,0) and another anonymous CB on (1,0) (disjoint cores → sum >
        // peak), plus an aliased CB on (0,0). Toggling the aliased CB off
        // must NOT change either total.
        const anonA = 1024;
        const anonB = 2048;
        const aliasedSize = 100_000;
        const snapshot: CBPressureSnapshot = {
            byCore: { '0,0': anonA, '1,0': anonB },
            maxBytes: anonB,
            unattributedBytes: 0,
            allocations: [
                {
                    nodeId: 1,
                    address: 0x1000,
                    size: aliasedSize,
                    numCores: 1,
                    coreRangeSet: '{[(x=0,y=0) - (x=0,y=0)]}',
                    cores: [{ x: 0, y: 0 }],
                    globallyAllocated: true,
                },
                {
                    nodeId: 2,
                    address: 0x2000,
                    size: anonA,
                    numCores: 1,
                    coreRangeSet: '{[(x=0,y=0) - (x=0,y=0)]}',
                    cores: [{ x: 0, y: 0 }],
                    globallyAllocated: false,
                },
                {
                    nodeId: 3,
                    address: 0x3000,
                    size: anonB,
                    numCores: 1,
                    coreRangeSet: '{[(x=1,y=0) - (x=1,y=0)]}',
                    cores: [{ x: 1, y: 0 }],
                    globallyAllocated: false,
                },
            ],
        };

        renderModal(snapshot);

        const peakRow = document.querySelector('.cb-list-total.row-peak') as HTMLElement;
        const sumRow = document.querySelector('.cb-list-total.row-sum') as HTMLElement;
        // Total CBs is visible because the two anonymous CBs sit on disjoint
        // cores, so sum (3 KiB) > peak (2 KiB).
        expect(peakRow).not.toBeNull();
        expect(sumRow).not.toBeNull();
        const peakValueBefore = peakRow.querySelector('.value')!.textContent;
        const sumValueBefore = sumRow.querySelector('.value')!.textContent;
        expect(peakValueBefore).toMatch(/^2\s*KiB/);
        expect(sumValueBefore).toMatch(/^3\s*KiB/);

        fireEvent.click(screen.getByLabelText('Show globally allocated CBs'));

        // Values do not move when the aliased CB is filtered out - they're
        // anchored to snapshot.maxBytes and the non-aliased sum, neither of
        // which depends on the toggle.
        const peakRowAfter = document.querySelector('.cb-list-total.row-peak') as HTMLElement;
        const sumRowAfter = document.querySelector('.cb-list-total.row-sum') as HTMLElement;
        expect(peakRowAfter.querySelector('.value')!.textContent).toBe(peakValueBefore);
        expect(sumRowAfter.querySelector('.value')!.textContent).toBe(sumValueBefore);
    });

    it('restores aliased CB rendering when the toggle is flipped back on', () => {
        renderModal(buildAliasedSnapshot());

        // Off: row stays in the legend but dimmed, strip rect drops.
        fireEvent.click(screen.getByLabelText('Show globally allocated CBs'));
        expect(document.querySelectorAll('button.cb-row.aliased-dimmed')).toHaveLength(1);
        expect(screen.getByText(/^\(1 hidden\)$/)).toBeInTheDocument();
        expect(getTensix(0, 0).querySelectorAll('.cb-strip-chunk')).toHaveLength(0);

        // On: dim class clears, hint disappears, strip rect comes back.
        fireEvent.click(screen.getByLabelText('Show globally allocated CBs'));
        expect(document.querySelectorAll('button.cb-row')).toHaveLength(2);
        expect(document.querySelectorAll('button.cb-row.aliased-dimmed')).toHaveLength(0);
        expect(document.querySelectorAll('button.cb-row.aliased')).toHaveLength(1);
        expect(screen.queryByText(/\(\d+ hidden\)/)).not.toBeInTheDocument();
        expect(getTensix(0, 0).querySelectorAll('.cb-strip-chunk.aliased')).toHaveLength(1);
    });
});

// Two CBs, one aliased (globally_allocated=1) on (0,0), one anonymous on (1,0).
// Matches the resnet50 op-8 pattern where the aliased CB at the tensor's
// address must not advance the per-core peak.
function buildAliasedSnapshot(): CBPressureSnapshot {
    const anonymousSize = 32;
    return {
        byCore: { '1,0': anonymousSize },
        maxBytes: anonymousSize,
        unattributedBytes: 0,
        allocations: [
            {
                nodeId: 1,
                address: 0x1000,
                size: 100_000,
                numCores: 1,
                coreRangeSet: '{[(x=0,y=0) - (x=0,y=0)]}',
                cores: [{ x: 0, y: 0 }],
                allocateOperationId: 100,
                allocateOperationName: 'halo',
                globallyAllocated: true,
            },
            {
                nodeId: 2,
                address: 0x2000,
                size: anonymousSize,
                numCores: 1,
                coreRangeSet: '{[(x=1,y=0) - (x=1,y=0)]}',
                cores: [{ x: 1, y: 0 }],
                allocateOperationId: 100,
                allocateOperationName: 'halo',
                globallyAllocated: false,
            },
        ],
    };
}

// Default fixture: two disjoint CBs (1 MiB on (0,0), 256 KiB on (1,0)).
// Peak is the per-core max, which equals the bigger CB; sum > peak so the
// Total CBs row is exercised by default.
function buildSnapshot(overrides: Partial<CBPressureSnapshot> = {}): CBPressureSnapshot {
    const cb1 = 1024 * 1024;
    const cb2 = 256 * 1024;
    return {
        byCore: { '0,0': cb1, '1,0': cb2 },
        maxBytes: cb1,
        unattributedBytes: 0,
        allocations: [
            {
                nodeId: 1,
                address: 0x1000,
                size: cb1,
                numCores: 1,
                coreRangeSet: '{[(x=0,y=0) - (x=0,y=0)]}',
                cores: [{ x: 0, y: 0 }],
                allocateOperationId: 100,
                allocateOperationName: 'demo_op',
                globallyAllocated: false,
            },
            {
                nodeId: 2,
                address: 0x2000,
                size: cb2,
                numCores: 1,
                coreRangeSet: '{[(x=1,y=0) - (x=1,y=0)]}',
                cores: [{ x: 1, y: 0 }],
                allocateOperationId: 100,
                allocateOperationName: 'demo_op',
                globallyAllocated: false,
            },
        ],
        ...overrides,
    };
}
