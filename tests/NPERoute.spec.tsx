// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { AxiosError, HttpStatusCode } from 'axios';
import { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import { TestProviders } from './helpers/TestProviders';
import { activeNpeOpTraceAtom } from '../src/store/app';
import { TEST_IDS } from '../src/definitions/TestIds';
import {
    NPE_FETCH_TIMEOUT_MS,
    NPE_PROCESSING_LABEL,
    NPE_RENDERING_LABEL,
    NPE_RENDER_TIMEOUT_MS,
    NpeAxiosErrorCode,
} from '../src/definitions/NPEData';
import type { NPEData } from '../src/model/NPEModel';

const { mockUseNpe, mockUseNPETimelineFile, mockUseParams, mockDiscardNpeQueries } = vi.hoisted(() => ({
    mockUseNpe: vi.fn(),
    mockUseNPETimelineFile: vi.fn(),
    mockUseParams: vi.fn(() => ({})),
    mockDiscardNpeQueries: vi.fn(),
}));

vi.mock('react-helmet-async', () => ({
    Helmet: () => null,
    HelmetProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../src/functions/getServerConfig', () => ({ default: () => null }));
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return {
        ...actual,
        useParams: () => mockUseParams(),
    };
});
vi.mock('../src/hooks/useAPI', async () => {
    const actual = await vi.importActual<typeof import('../src/hooks/useAPI')>('../src/hooks/useAPI');
    return {
        ...actual,
        useNpe: (...args: unknown[]) => mockUseNpe(...args),
        useNPETimelineFile: (...args: unknown[]) => mockUseNPETimelineFile(...args),
        discardNpeQueries: (...args: unknown[]) => mockDiscardNpeQueries(...args),
    };
});
vi.mock('../src/components/npe/NPEFileLoader', () => ({
    default: () => <div data-testid={TEST_IDS.NPE_FILE_LOADER} />,
}));
vi.mock('../src/components/npe/NPEDemoSelect', () => ({
    default: () => null,
}));

let callOnRendered = true;
let capturedOnRendered: (() => void) | null = null;

vi.mock('../src/components/npe/NPEViewComponent', () => ({
    default: function MockNPEView({ onRendered }: { onRendered?: () => void }) {
        // Match production: fire once on mount, not when the parent recreates onRendered.
        useEffect(() => {
            capturedOnRendered = onRendered ?? null;
            if (callOnRendered) {
                onRendered?.();
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only ready signal
        }, []);
        return <div data-testid={TEST_IDS.NPE_VIEW} />;
    },
}));

// eslint-disable-next-line import/first
import NPE from '../src/routes/NPE';

const validNpeData = {
    common_info: { version: '1.0.0' },
    noc_transfers: [{ id: 0 }],
    timestep_data: [{ active_transfers: [] }],
} as unknown as NPEData;

const idleTimeline = {
    data: undefined,
    isLoading: false,
    error: null,
};

const settledNpe = {
    data: validNpeData,
    isLoading: false,
    error: null,
};

const SwitchNpeFileButton = ({ fileName }: { fileName: string }) => {
    const setActiveNpe = useSetAtom(activeNpeOpTraceAtom);
    return (
        <button
            type='button'
            onClick={() => setActiveNpe(fileName)}
        >
            switch-npe-file
        </button>
    );
};

const renderRoute = (fileName: string | null = 'trace.json') =>
    render(
        <TestProviders initialAtomValues={[[activeNpeOpTraceAtom, fileName]]}>
            <NPE />
            <SwitchNpeFileButton fileName='other-trace.json' />
        </TestProviders>,
    );

beforeEach(() => {
    callOnRendered = true;
    capturedOnRendered = null;
    mockUseParams.mockReturnValue({});
    mockUseNpe.mockReturnValue(settledNpe);
    mockUseNPETimelineFile.mockReturnValue(idleTimeline);
    mockDiscardNpeQueries.mockClear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('NPE route loading and error wiring', () => {
    it('shows Processing while the active NPE query is loading', () => {
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });
        renderRoute();

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOADING).textContent).toContain(NPE_PROCESSING_LABEL);
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).not.toBeInTheDocument();
    });

    it('shows Rendering after data is ready and before onRendered', () => {
        callOnRendered = false;
        vi.useFakeTimers();
        renderRoute();

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOADING).textContent).toContain(NPE_RENDERING_LABEL);

        act(() => {
            vi.advanceTimersByTime(0);
        });

        const view = screen.getByTestId(TEST_IDS.NPE_VIEW);
        expect(view.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('clears the spinner after onRendered', () => {
        vi.useFakeTimers();
        renderRoute();

        act(() => {
            vi.advanceTimersByTime(0);
        });

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_LOADING)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW).closest('[aria-hidden="false"]')).not.toBeNull();
    });

    it('maps PAYLOAD_TOO_LARGE to the payload-too-large status', () => {
        const error = new AxiosError('empty');
        error.code = NpeAxiosErrorCode.PAYLOAD_TOO_LARGE;
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: false, error });
        renderRoute();

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_PAYLOAD_TOO_LARGE)).toBeInTheDocument();
    });

    it('maps ECONNABORTED to the load-timeout status', () => {
        const error = new AxiosError('aborted');
        error.code = AxiosError.ECONNABORTED;
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: false, error });
        renderRoute();

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOAD_TIMEOUT)).toBeInTheDocument();
    });

    it('maps ETIMEDOUT to the load-timeout status', () => {
        const error = new AxiosError('timed out');
        error.code = AxiosError.ETIMEDOUT;
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: false, error });
        renderRoute();

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOAD_TIMEOUT)).toBeInTheDocument();
    });

    it('maps INVALID_JSON, ERR_BAD_RESPONSE, and 422 to the invalid-json status', () => {
        const invalidJson = new AxiosError('bad json');
        invalidJson.code = NpeAxiosErrorCode.INVALID_JSON;
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: false, error: invalidJson });
        const { unmount } = renderRoute();
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INVALID_JSON)).toBeInTheDocument();
        unmount();

        const badResponse = new AxiosError('bad response');
        badResponse.code = AxiosError.ERR_BAD_RESPONSE;
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: false, error: badResponse });
        const second = renderRoute();
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INVALID_JSON)).toBeInTheDocument();
        second.unmount();

        const unprocessable = new AxiosError('422');
        unprocessable.status = HttpStatusCode.UnprocessableEntity;
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: false, error: unprocessable });
        renderRoute();
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INVALID_JSON)).toBeInTheDocument();
    });

    it('times out a stuck fetch and discards NPE queries', () => {
        vi.useFakeTimers();
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });
        renderRoute();

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOADING)).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(NPE_FETCH_TIMEOUT_MS);
        });

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOAD_TIMEOUT)).toBeInTheDocument();
        expect(mockDiscardNpeQueries).toHaveBeenCalled();
    });

    it('times out when fetch settles after the wall-clock budget (sync parse path)', () => {
        vi.useFakeTimers();
        let now = 1_000;
        vi.stubGlobal('performance', { now: () => now });

        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });

        const TickHarness = () => {
            const [tick, setTick] = useState(0);
            return (
                <>
                    <button
                        type='button'
                        onClick={() => setTick((value) => value + 1)}
                    >
                        tick-{tick}
                    </button>
                    <NPE />
                </>
            );
        };

        render(
            <TestProviders initialAtomValues={[[activeNpeOpTraceAtom, 'trace.json']]}>
                <TickHarness />
            </TestProviders>,
        );

        now += NPE_FETCH_TIMEOUT_MS + 1;
        mockUseNpe.mockReturnValue(settledNpe);
        act(() => {
            screen.getByRole('button', { name: /tick-/ }).click();
        });

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOAD_TIMEOUT)).toBeInTheDocument();
        expect(mockDiscardNpeQueries).toHaveBeenCalled();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).not.toBeInTheDocument();
    });

    it('times out when onRendered never fires and discards NPE queries', () => {
        callOnRendered = false;
        vi.useFakeTimers();
        renderRoute();

        act(() => {
            vi.advanceTimersByTime(0);
        });
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(NPE_RENDER_TIMEOUT_MS);
        });

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_RENDER_TIMEOUT)).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).not.toBeInTheDocument();
        expect(mockDiscardNpeQueries).toHaveBeenCalled();
    });

    it('times out when onRendered fires after the render budget', () => {
        callOnRendered = false;
        vi.useFakeTimers();
        let now = 5_000;
        vi.stubGlobal('performance', { now: () => now });

        renderRoute();

        act(() => {
            vi.advanceTimersByTime(0);
        });
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
        expect(capturedOnRendered).not.toBeNull();

        now += NPE_RENDER_TIMEOUT_MS + 1;
        act(() => {
            capturedOnRendered?.();
        });

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_RENDER_TIMEOUT)).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).not.toBeInTheDocument();
        expect(mockDiscardNpeQueries).toHaveBeenCalled();
    });

    it('clears timeout UI when the active report identity changes', () => {
        vi.useFakeTimers();
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });
        renderRoute('trace.json');

        act(() => {
            vi.advanceTimersByTime(NPE_FETCH_TIMEOUT_MS);
        });
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOAD_TIMEOUT)).toBeInTheDocument();

        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });
        act(() => {
            screen.getByRole('button', { name: 'switch-npe-file' }).click();
        });

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_LOAD_TIMEOUT)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOADING).textContent).toContain(NPE_PROCESSING_LABEL);
    });

    it('clears sticky timeout UI when the same report starts fetching again', () => {
        vi.useFakeTimers();

        const TickHarness = () => {
            const [tick, setTick] = useState(0);
            return (
                <>
                    <button
                        type='button'
                        onClick={() => setTick((value) => value + 1)}
                    >
                        tick-{tick}
                    </button>
                    <NPE />
                </>
            );
        };

        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });
        render(
            <TestProviders initialAtomValues={[[activeNpeOpTraceAtom, 'trace.json']]}>
                <TickHarness />
            </TestProviders>,
        );

        act(() => {
            vi.advanceTimersByTime(NPE_FETCH_TIMEOUT_MS);
        });
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOAD_TIMEOUT)).toBeInTheDocument();

        // Simulate post-discard idle, then same-report refetch (focus/retry) without identity change.
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: false, error: null });
        act(() => {
            screen.getByRole('button', { name: /tick-/ }).click();
        });

        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });
        act(() => {
            screen.getByRole('button', { name: /tick-/ }).click();
        });

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_LOAD_TIMEOUT)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOADING).textContent).toContain(NPE_PROCESSING_LABEL);

        mockUseNpe.mockReturnValue(settledNpe);
        act(() => {
            screen.getByRole('button', { name: /tick-/ }).click();
        });
        act(() => {
            vi.advanceTimersByTime(0);
        });

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_LOAD_TIMEOUT)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
    });

    it('does not stay on Processing when the disabled sibling query is still loading', () => {
        mockUseParams.mockReturnValue({ filepath: 'timeline.json' });
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });
        mockUseNPETimelineFile.mockReturnValue({
            data: validNpeData,
            isLoading: false,
            error: null,
        });

        vi.useFakeTimers();
        renderRoute(null);

        expect(screen.queryByText(NPE_PROCESSING_LABEL)).not.toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(0);
        });

        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
    });
});
