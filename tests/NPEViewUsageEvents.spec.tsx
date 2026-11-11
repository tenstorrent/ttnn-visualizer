// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NPEView from '../src/components/npe/NPEViewComponent';
import { NPEData } from '../src/model/NPEModel';
import { EventLogEvent, NpeMode } from '../src/definitions/EventLogEvent';
import { altCongestionColorsAtom } from '../src/store/app';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { TestProviders } from './helpers/TestProviders';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

// The heavy visual children and data hooks are irrelevant to which controls record.
vi.mock('../src/components/npe/NPETimelineComponent', () => ({ default: () => null }));
vi.mock('../src/components/npe/TensixTransferRenderer', () => ({ default: () => null }));
vi.mock('../src/components/npe/RouteOriginsRenderer', () => ({ RouteOriginsRenderer: () => null }));
vi.mock('../src/components/npe/ActiveTransferDetails', () => ({ default: () => null }));
vi.mock('../src/components/npe/NPEMetadata', () => ({ default: () => null }));
vi.mock('../src/components/npe/EmptyChipRenderer', () => ({ EmptyChipRenderer: () => null }));
vi.mock('../src/components/npe/NPEZoneFilterComponent', () => ({ default: () => null }));
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

function renderView(initialAtomValues: AtomProviderInitialValues = [], nocTransfers: unknown[] = []) {
    return render(
        <TestProviders initialAtomValues={initialAtomValues}>
            <NPEView npeData={makeNpeData(nocTransfers)} />
        </TestProviders>,
    );
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
    vi.useFakeTimers();
    recordEvent.mockClear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('NPEView usage events', () => {
    it('records nothing on mount, including a saved alternate-colour preference', () => {
        renderView([[altCongestionColorsAtom, true]]);

        expect(recordEvent).not.toHaveBeenCalled();
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

    it('records the alternate congestion colours switch in either direction', () => {
        renderView();

        fireEvent.click(screen.getByLabelText('Alternate congestion colors'));
        fireEvent.click(screen.getByLabelText('Alternate congestion colors'));

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

    it('records the event filter state each switch leads to', () => {
        renderView([], [FABRIC_TRANSFER]);

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
});
