// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NPEView from '../src/components/npe/NPEViewComponent';
import { NPEData } from '../src/model/NPEModel';
import { EventLogEvent, NpeMode } from '../src/definitions/EventLogEvent';
import { TestProviders } from './helpers/TestProviders';

const { recordEvent, zonesPanel } = vi.hoisted(() => ({
    recordEvent: vi.fn(),
    zonesPanel: { onClose: null as (() => void) | null },
}));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

// The heavy visual children and data hooks are irrelevant to which controls record.
vi.mock('../src/components/npe/NPETimelineComponent', () => ({ default: () => null }));
vi.mock('../src/components/npe/TensixTransferRenderer', () => ({ default: () => null }));
vi.mock('../src/components/npe/RouteOriginsRenderer', () => ({ RouteOriginsRenderer: () => null }));
vi.mock('../src/components/npe/ActiveTransferDetails', () => ({ default: () => null }));
vi.mock('../src/components/npe/NPEMetadata', () => ({ default: () => null }));
vi.mock('../src/components/npe/EmptyChipRenderer', () => ({ EmptyChipRenderer: () => null }));
// Keeps the panel's close callback, so a test can close it the way its own button would.
vi.mock('../src/components/npe/NPEZoneFilterComponent', () => ({
    default: ({ onClose }: { onClose: () => void }) => {
        zonesPanel.onClose = onClose;
        return null;
    },
}));
vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock();
});
vi.mock('../src/components/npe/useNPEHandlers', () => ({
    useSelectedTransferGrouping: () => ({ transferListSelectionRendering: new Map(), groupedTransfersByNoCID: {} }),
    useShowActiveTransfers: () => vi.fn(),
}));
vi.mock('../src/hooks/useAPI', () => ({
    useNodeType: () => ({
        architecture: { arch_name: 'wormhole_b0', grid: { x_size: 2, y_size: 2 } },
        cores: [],
        dram: [],
        eth: [],
        pcie: [],
    }),
}));

const makeNpeData = (nocTransfers: unknown[] = []): NPEData =>
    ({
        common_info: { arch: 'wormhole_b0', version: '1.0.0', cycles_per_timestep: 1 },
        chips: { '0': [0, 0, 0, 0] },
        noc_transfers: nocTransfers,
        timestep_data: [
            { start_cycle: 0, end_cycle: 9, active_transfers: [], link_demand: [] },
            { start_cycle: 10, end_cycle: 19, active_transfers: [], link_demand: [] },
        ],
        zones: [],
    }) as unknown as NPEData;

const modeChanged = (mode: NpeMode) => ({ event: EventLogEvent.NPE_MODE_CHANGED, details: { npe_mode: mode } });
const playbackStarted = { event: EventLogEvent.NPE_PLAYBACK_STARTED, details: {} };

// Inactive at every timestep: it exists only so the trace counts as carrying fabric events.
const FABRIC_TRANSFER = {
    id: 0,
    total_bytes: 0,
    noc_event_type: '',
    fabric_event_type: true,
    start_cycle: 0,
    end_cycle: 0,
    route: [],
};

const viewTree = (nocTransfers: unknown[], hasFabricEvents?: boolean) => (
    <TestProviders>
        <NPEView
            npeData={makeNpeData(nocTransfers)}
            hasFabricEvents={hasFabricEvents}
        />
    </TestProviders>
);

function renderView(nocTransfers: unknown[] = [], hasFabricEvents?: boolean) {
    const view = render(viewTree(nocTransfers, hasFabricEvents));

    return {
        ...view,
        showTrace: (transfers: unknown[]) => view.rerender(viewTree(transfers, hasFabricEvents)),
    };
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
    vi.useFakeTimers();
    recordEvent.mockClear();
    zonesPanel.onClose = null;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
});

describe('NPEView usage events', () => {
    it('records nothing on mount', () => {
        renderView();

        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('records nothing when a saved alternate-colour preference is restored', () => {
        // Seeded in storage rather than hydrated, so the atom restores it after mount.
        window.localStorage.setItem('altCongestionColors', 'true');
        renderView();

        expect(screen.getByLabelText<HTMLInputElement>('Alternate congestion colors').checked).toBe(true);
        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('records a start after playback was stopped by stepping', () => {
        renderView();

        click('Play');
        click('Step forward');
        click('Play');

        expect(recordEvent.mock.calls).toEqual([[playbackStarted], [playbackStarted]]);
    });

    it('records a playback start once, and never per animation tick', () => {
        renderView();

        click('Play');
        act(() => {
            vi.advanceTimersByTime(1_000);
        });

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(playbackStarted);
    });

    it('records each start after a pause', () => {
        renderView();

        click('Play');
        click('Pause');
        click('Play');

        expect(recordEvent.mock.calls).toEqual([[playbackStarted], [playbackStarted]]);
    });

    it('records 2x from a standstill but not as a speed change during playback', () => {
        renderView();

        click('Play 2x speed');
        click('Pause');
        click('Play');
        click('Play 2x speed');

        expect(recordEvent.mock.calls).toEqual([[playbackStarted], [playbackStarted]]);
    });

    it('records the mode chosen and ignores a click on the active one', () => {
        renderView();

        click('Congestion Mode');
        click('Transfers Scope Mode');
        click('Transfers Scope Mode');
        click('Congestion Mode');

        expect(recordEvent.mock.calls).toEqual([[modeChanged(NpeMode.TRANSFERS)], [modeChanged(NpeMode.CONGESTION)]]);
    });

    it('records the scale chosen and ignores a click on the active one', () => {
        renderView();

        click('Timesteps');
        click('Cycles');
        click('Timesteps');

        expect(recordEvent.mock.calls).toEqual([
            [modeChanged(NpeMode.CYCLES_SCALE)],
            [modeChanged(NpeMode.TIMESTEPS_SCALE)],
        ]);
    });

    it('records the NoC filter state each switch leads to', () => {
        renderView();

        // Both shown, so turning NOC0 off leaves NOC1; turning it back on shows both again.
        fireEvent.click(screen.getByLabelText('NOC0'));
        fireEvent.click(screen.getByLabelText('NOC0'));
        fireEvent.click(screen.getByLabelText('NOC1'));

        expect(recordEvent.mock.calls).toEqual([
            [modeChanged(NpeMode.NOC1)],
            [modeChanged(NpeMode.ALL_NOCS)],
            [modeChanged(NpeMode.NOC0)],
        ]);
    });

    it('records the other NoC when the only one shown is switched off', () => {
        renderView();

        fireEvent.click(screen.getByLabelText('NOC1'));
        fireEvent.click(screen.getByLabelText('NOC0'));

        expect(recordEvent.mock.calls).toEqual([[modeChanged(NpeMode.NOC0)], [modeChanged(NpeMode.NOC1)]]);
        expect(screen.getByLabelText('NOC0')).not.toBeChecked();
        expect(screen.getByLabelText('NOC1')).toBeChecked();
    });

    it('records the alternate congestion colours switch in either direction', () => {
        renderView();

        const altColours = screen.getByLabelText<HTMLInputElement>('Alternate congestion colors');
        expect(altColours.checked).toBe(false);

        fireEvent.click(altColours);
        expect(altColours.checked).toBe(true);
        fireEvent.click(altColours);
        expect(altColours.checked).toBe(false);

        expect(recordEvent.mock.calls).toEqual([
            [modeChanged(NpeMode.ALT_CONGESTION_COLOURS)],
            [modeChanged(NpeMode.ALT_CONGESTION_COLOURS)],
        ]);
    });

    it('records opening the zones panel, not a click on it while open', () => {
        renderView();

        click('Zones');
        click('Zones');

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(modeChanged(NpeMode.ZONES));
    });

    it('records opening the zones panel again after it was closed', () => {
        renderView();

        click('Zones');
        act(() => zonesPanel.onClose?.());
        click('Zones');

        expect(recordEvent.mock.calls).toEqual([[modeChanged(NpeMode.ZONES)], [modeChanged(NpeMode.ZONES)]]);
    });

    it('records the event filter state each switch leads to', () => {
        renderView([FABRIC_TRANSFER]);

        // Both shown, so turning fabric events off leaves local; turning it back on shows
        // both again; turning local off leaves fabric.
        fireEvent.click(screen.getByLabelText('Fabric events'));
        fireEvent.click(screen.getByLabelText('Fabric events'));
        fireEvent.click(screen.getByLabelText('Local events'));

        expect(recordEvent.mock.calls).toEqual([
            [modeChanged(NpeMode.LOCAL_EVENTS)],
            [modeChanged(NpeMode.ALL_EVENTS)],
            [modeChanged(NpeMode.FABRIC_EVENTS)],
        ]);
    });

    it('records each event filter state, including from one scope straight to the other', () => {
        renderView([FABRIC_TRANSFER]);
        const fabric = screen.getByLabelText('Fabric events');
        const local = screen.getByLabelText('Local events');

        fireEvent.click(local);
        expect([fabric, local].map((input) => (input as HTMLInputElement).checked)).toEqual([true, false]);
        // Fabric only, so switching fabric off shows local instead of nothing.
        fireEvent.click(fabric);
        expect([fabric, local].map((input) => (input as HTMLInputElement).checked)).toEqual([false, true]);
        fireEvent.click(local);
        expect([fabric, local].map((input) => (input as HTMLInputElement).checked)).toEqual([true, false]);
        fireEvent.click(local);
        expect([fabric, local].map((input) => (input as HTMLInputElement).checked)).toEqual([true, true]);

        expect(recordEvent.mock.calls).toEqual([
            [modeChanged(NpeMode.FABRIC_EVENTS)],
            [modeChanged(NpeMode.LOCAL_EVENTS)],
            [modeChanged(NpeMode.FABRIC_EVENTS)],
            [modeChanged(NpeMode.ALL_EVENTS)],
        ]);
    });

    it('records nothing when a trace without fabric events resets the event filter', () => {
        const { showTrace } = renderView([FABRIC_TRANSFER]);

        fireEvent.click(screen.getByLabelText('Fabric events'));
        showTrace([]);

        expect(screen.getByLabelText('Fabric events')).toBeChecked();
        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(modeChanged(NpeMode.LOCAL_EVENTS));
    });

    // #2356: a windowed trace holds one window's transfers, so the whole trace's
    // answer comes in as a prop and a window without fabric events must not reset it.
    it('keeps the event filter when a windowed trace with fabric events shows a window without any', () => {
        const { showTrace } = renderView([FABRIC_TRANSFER], true);

        fireEvent.click(screen.getByLabelText('Fabric events'));
        showTrace([]);

        expect(screen.getByLabelText('Fabric events')).not.toBeChecked();
        expect(screen.getByLabelText('Fabric events')).toBeEnabled();
        expect(screen.getByLabelText('Local events')).toBeChecked();
        expect(screen.getByLabelText('Local events')).toBeEnabled();
        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(modeChanged(NpeMode.LOCAL_EVENTS));
    });

    it('enables the event filter for a windowed trace with fabric events when the first window has none', () => {
        renderView([], true);

        expect(screen.getByLabelText('Fabric events')).toBeEnabled();
        expect(screen.getByLabelText('Local events')).toBeEnabled();

        fireEvent.click(screen.getByLabelText('Fabric events'));

        expect(screen.getByLabelText('Local events')).toBeChecked();
        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(modeChanged(NpeMode.LOCAL_EVENTS));
    });

    it('disables the event filter for a windowed trace without fabric events even when a window has one', () => {
        renderView([FABRIC_TRANSFER], false);

        expect(screen.getByLabelText('Fabric events')).toBeDisabled();
        expect(screen.getByLabelText('Local events')).toBeDisabled();
    });
});
