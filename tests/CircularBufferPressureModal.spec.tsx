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
                },
                {
                    nodeId: 12,
                    address: 0x2000,
                    size: cb2,
                    numCores: 1,
                    coreRangeSet: '{[(x=0,y=0) - (x=0,y=0)]}',
                    cores: [{ x: 0, y: 0 }],
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
});

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
            },
        ],
        ...overrides,
    };
}
