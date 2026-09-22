// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import L1PeakComposition from '../src/components/buffer-summary/L1PeakComposition';
import { useL1PeakDecomposition } from '../src/hooks/useL1PeakDecomposition';
import { useDevices, useOperationsList } from '../src/hooks/useAPI';
import { L1PeakPrecision, L1PeakStatus, L1ResidentKind, L1_PEAK_SERIES } from '../src/definitions/L1PeakDecomposition';
import { L1PeakDecomposition, L1PeakDecompositionResult } from '../src/model/L1PeakDecomposition';

vi.mock('../src/hooks/useL1PeakDecomposition', () => ({ useL1PeakDecomposition: vi.fn() }));
vi.mock('../src/hooks/useAPI', () => ({ useOperationsList: vi.fn(), useDevices: vi.fn() }));
// Plotly needs a real layout engine; the chart is not what these assertions are about.
vi.mock('../src/libs/PlotComponent', () => ({ default: () => <div data-testid='plot' /> }));

const decomposition = (overrides: Partial<L1PeakDecomposition> = {}): L1PeakDecomposition => ({
    operationId: 29,
    totalBytes: 1000,
    circularBufferBytes: 600,
    intermediateTensorBytes: 200,
    persistentTensorBytes: 200,
    staleTensorBytes: 0,
    precision: L1PeakPrecision.UPPER_BOUND,
    contributors: [{ address: 766208, bytes: 600, kind: L1ResidentKind.CIRCULAR_BUFFER, lastUsedByOperationId: null }],
    reconciledAwayCount: 0,
    ...overrides,
});

const result = (overrides: Partial<L1PeakDecompositionResult> = {}): L1PeakDecompositionResult => {
    const peak = overrides.peak === undefined ? decomposition() : overrides.peak;

    return {
        byOperationId: new Map(peak ? [[peak.operationId, peak]] : []),
        peak,
        reconciledAwayCount: 0,
        capacityBytes: 2000,
        exceedsCapacity: false,
        ...overrides,
    };
};

const mount = (state: Partial<ReturnType<typeof useL1PeakDecomposition>>, devices: unknown[] = [{}]) => {
    vi.mocked(useL1PeakDecomposition).mockReturnValue({
        status: L1PeakStatus.READY,
        data: result(),
        unattributableStaleAddressCount: 0,
        ...state,
    } as never);
    vi.mocked(useOperationsList).mockReturnValue({ data: [{ id: 29, name: 'ttnn.conv2d' }] } as never);
    vi.mocked(useDevices).mockReturnValue({ data: devices } as never);

    return render(
        <MemoryRouter>
            <L1PeakComposition />
        </MemoryRouter>,
    );
};

describe('L1PeakComposition', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(cleanup);

    it('asks for a report rather than claiming the report has no L1', () => {
        mount({ status: L1PeakStatus.UNAVAILABLE, data: null });

        expect(screen.getByText(/select a memory report/i)).toBeInTheDocument();
        expect(screen.queryByText(/no L1 activity/i)).not.toBeInTheDocument();
    });

    it('says a fetch failed rather than blaming the capture', () => {
        // The failure mode this replaces: an errored buffer query read as settled-with-undefined,
        // so the view printed "This report records no L1 activity" about a working report.
        // Passing a non-null result deliberately: the error must be decided by status, not by
        // happening to have no data, or a partially-populated failure renders as fact.
        mount({ status: L1PeakStatus.ERROR, data: result() });

        expect(screen.getByText(/fetch failure, not a statement about the report/i)).toBeInTheDocument();
        expect(screen.queryByText(/no L1 activity/i)).not.toBeInTheDocument();
        expect(screen.queryByText('Upper bound')).not.toBeInTheDocument();
    });

    it('distinguishes a report that genuinely has no L1', () => {
        mount({ data: result({ peak: null }) });

        expect(screen.getByText(/records no L1 activity/i)).toBeInTheDocument();
    });

    it('refuses a peak that exceeds the device L1 instead of printing it', () => {
        // A callout prepended above the figures is not a refusal — the headline, chart and
        // table must not render at all.
        mount({ data: result({ exceedsCapacity: true, capacityBytes: 500 }) });

        expect(screen.getByText(/not usable/i)).toBeInTheDocument();
        expect(screen.queryByText(/peak L1 per core/i)).not.toBeInTheDocument();
        expect(screen.queryByText('Tightest operations')).not.toBeInTheDocument();
    });

    it('draws one band per resident kind, covering every kind and every byte field once', () => {
        // The comment on L1_PEAK_SERIES used to claim the list could not fall behind the enum.
        // An array cannot be exhaustive over an enum, so that is this test's job: the Records
        // in the same file catch a new kind, and this catches the band that was never added
        // for it, which would otherwise render as a silently missing slice of the total.
        const kinds = L1_PEAK_SERIES.map((series) => series.kind);
        const fields = L1_PEAK_SERIES.map((series) => series.field);

        expect(new Set(kinds)).toEqual(new Set(Object.values(L1ResidentKind)));
        expect(kinds).toHaveLength(Object.values(L1ResidentKind).length);
        expect(new Set(fields).size).toBe(fields.length);
    });

    it('names multi-device aggregation among the causes when the refusal fires on such a report', () => {
        // The refusal used to return before the multi-device notice could render and offer two
        // causes as the only two. Summing residents across devices is a third, and on a mesh
        // report it is the likeliest — leaving it out misdiagnoses the result.
        mount({ data: result({ exceedsCapacity: true, capacityBytes: 500 }) }, [{}, {}, {}]);

        expect(screen.getByText(/not usable/i)).toBeInTheDocument();
        expect(screen.getByText(/covers 3 devices/i)).toBeInTheDocument();
        expect(screen.getByText(/summed across this report's 3 devices/i)).toBeInTheDocument();
    });

    it('offers only the causes that apply when a single-device report is refused', () => {
        mount({ data: result({ exceedsCapacity: true, capacityBytes: 500 }) }, [{}]);

        expect(screen.getByText(/not usable/i)).toBeInTheDocument();
        expect(screen.queryByText(/devices/i)).not.toBeInTheDocument();
    });

    it('caveats an upper bound found anywhere in the run, not only at the peak', () => {
        const exactPeak = decomposition({ precision: L1PeakPrecision.EXACT });
        const boundedElsewhere = decomposition({
            operationId: 7,
            totalBytes: 10,
            precision: L1PeakPrecision.UPPER_BOUND,
        });

        mount({
            data: result({
                peak: exactPeak,
                byOperationId: new Map([
                    [exactPeak.operationId, exactPeak],
                    [boundedElsewhere.operationId, boundedElsewhere],
                ]),
            }),
        });

        expect(screen.getByText(/records how many cores it spans but not which/i)).toBeInTheDocument();
    });

    it('explains the repeat marker without needing a hover', () => {
        const peak = decomposition();
        const twin = decomposition({ operationId: 130 });

        mount({
            data: result({
                peak,
                byOperationId: new Map([
                    [peak.operationId, peak],
                    [twin.operationId, twin],
                ]),
            }),
        });

        expect(screen.getByText('+1 like it')).toBeInTheDocument();
        expect(screen.getByText(/listed once, marked with how many others match/i)).toBeInTheDocument();
    });

    it('marks a multi-resident peak as an upper bound and explains why', () => {
        mount({});

        expect(screen.getByText('Upper bound')).toBeInTheDocument();
        expect(screen.getByText(/records how many cores it spans but not which/i)).toBeInTheDocument();
    });

    it('does not claim an upper bound for a single resident', () => {
        mount({ data: result({ peak: decomposition({ precision: L1PeakPrecision.EXACT }) }) });

        expect(screen.getByText('Exact')).toBeInTheDocument();
        expect(screen.queryByText(/records how many cores it spans/i)).not.toBeInTheDocument();
    });

    it('links each listed operation to its details page, named', () => {
        mount({});

        expect(screen.getByRole('link', { name: /29 ttnn\.conv2d/ })).toHaveAttribute('href', '/operations/29');
    });

    it('says the stale figure is a floor when addresses could not be attributed', () => {
        mount({ unattributableStaleAddressCount: 25 });

        expect(screen.getByText(/stale is a floor/i)).toBeInTheDocument();
        expect(screen.getByText(/25 addresses are reused/i)).toBeInTheDocument();
    });

    it('stays quiet about attribution when every address resolved', () => {
        mount({ unattributableStaleAddressCount: 0 });

        expect(screen.queryByText(/stale is a floor/i)).not.toBeInTheDocument();
    });

    it('warns that a multi-device report is summed across devices', () => {
        // The replay cannot separate devices — captures label CB allocation and release with
        // different ids — so the occupancy is a sum and the percentage is against one device.
        mount({}, [{}, {}]);

        expect(screen.getByText(/multi-device report/i)).toBeInTheDocument();
        expect(screen.getByText(/percentage is not meaningful/i)).toBeInTheDocument();
    });

    it('stays quiet about devices on a single-device report', () => {
        mount({});

        expect(screen.queryByText(/multi-device report/i)).not.toBeInTheDocument();
    });

    it('describes the reconciled count as the snapshot deciding, not the graph', () => {
        mount({ data: result({ reconciledAwayCount: 32 }) });

        expect(screen.getByText(/snapshot no longer held them/i)).toBeInTheDocument();
    });
});
