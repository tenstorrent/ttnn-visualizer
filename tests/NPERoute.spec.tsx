// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AxiosError, HttpStatusCode } from 'axios';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from './helpers/TestProviders';
import { minimalValidNpeData } from './helpers/npeFixtures';
import { activeNpeOpTraceAtom } from '../src/store/app';
import { TEST_IDS } from '../src/definitions/TestIds';

// Mutable holders shared with the hoisted mock factories so each case can flip
// SERVER_MODE / route params and inspect how useNpe was gated.
const h = vi.hoisted(() => ({
    // Default true so loading/error tests exercise the whole-file path; windowed
    // gate tests flip this to false (local upload → NpeWindowedView).
    serverMode: true as boolean,
    params: {} as { filepath?: string },
    useNpeArgs: [] as (string | null)[],
}));

const { mockUseNpe, mockUseNPETimelineFile } = vi.hoisted(() => ({
    mockUseNpe: vi.fn(),
    mockUseNPETimelineFile: vi.fn(),
}));

vi.mock('../src/functions/getServerConfig', () => ({ default: () => ({ SERVER_MODE: h.serverMode }) }));
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return {
        ...actual,
        useParams: () => h.params,
    };
});
vi.mock('react-helmet-async', () => ({
    Helmet: () => null,
    HelmetProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../src/hooks/useAPI', async () => {
    const actual = await vi.importActual<typeof import('../src/hooks/useAPI')>('../src/hooks/useAPI');
    return {
        ...actual,
        useNpe: (arg: string | null) => {
            h.useNpeArgs.push(arg);
            return mockUseNpe(arg);
        },
        useNPETimelineFile: (...args: unknown[]) => mockUseNPETimelineFile(...args),
    };
});
vi.mock('../src/components/npe/NpeWindowedView', () => ({
    default: () => <div data-testid={TEST_IDS.NPE_WINDOWED_VIEW} />,
}));
vi.mock('../src/components/npe/NPEViewComponent', () => ({
    default: () => <div data-testid={TEST_IDS.NPE_VIEW} />,
}));
vi.mock('../src/components/npe/NPEFileLoader', () => ({ default: () => null }));
vi.mock('../src/components/npe/NPEDemoSelect', () => ({ default: () => null }));

// Import after vi.mock so the route under test sees the stubs.
// eslint-disable-next-line import/first
import NPE from '../src/routes/NPE';

const idleTimeline = {
    data: undefined,
    isLoading: false,
    error: null,
};

const settledNpe = {
    data: minimalValidNpeData,
    isLoading: false,
    error: null,
};

const lastUseNpeArg = () => h.useNpeArgs[h.useNpeArgs.length - 1];

const makeHttpError = (status: number, message: string, code?: string) => {
    const error = new AxiosError(message);
    error.status = status;
    if (code) {
        error.code = code;
    }
    return error;
};

const renderRoute = (fileName: string | null = 'trace.json') =>
    render(
        <TestProviders initialAtomValues={[[activeNpeOpTraceAtom, fileName]]}>
            <NPE />
        </TestProviders>,
    );

beforeEach(() => {
    h.serverMode = true;
    h.params = {};
    h.useNpeArgs = [];
    mockUseNpe.mockReturnValue(settledNpe);
    mockUseNPETimelineFile.mockReturnValue(idleTimeline);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    getDefaultStore().set(activeNpeOpTraceAtom, null);
});

describe('NPE route windowed-view gate', () => {
    it('mounts the windowed view and skips useNpe for a local upload', () => {
        h.serverMode = false;
        renderRoute();

        expect(screen.getByTestId(TEST_IDS.NPE_WINDOWED_VIEW)).toBeInTheDocument();
        // The whole-file fetch is skipped so it can't choke on the large payload.
        expect(lastUseNpeArg()).toBeNull();
    });

    it('keeps the whole-file path under SERVER_MODE (hosted)', () => {
        h.serverMode = true;
        renderRoute();

        expect(screen.queryByTestId(TEST_IDS.NPE_WINDOWED_VIEW)).toBeNull();
        // Hosted still fetches the whole file by name.
        expect(lastUseNpeArg()).toBe('trace.json');
    });

    it('keeps the whole-file path when viewing a saved report by filepath', () => {
        h.serverMode = false;
        h.params = { filepath: 'saved-report.json' };
        mockUseNPETimelineFile.mockReturnValue({
            data: minimalValidNpeData,
            isLoading: false,
            error: null,
        });
        renderRoute('trace.json');

        expect(screen.queryByTestId(TEST_IDS.NPE_WINDOWED_VIEW)).toBeNull();
        expect(lastUseNpeArg()).toBeNull();
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
    });

    it('does not mount the windowed view when there is no uploaded file', () => {
        h.serverMode = false;
        renderRoute(null);
        expect(screen.queryByTestId(TEST_IDS.NPE_WINDOWED_VIEW)).toBeNull();
    });
});

describe('NPE route error mapping', () => {
    it('shows a loading spinner while the active NPE query is loading', () => {
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });
        renderRoute();

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOADING)).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).not.toBeInTheDocument();
    });

    it('does not pin the spinner on a background refetch when data is already present', () => {
        mockUseNpe.mockReturnValue({
            data: minimalValidNpeData,
            isLoading: false,
            isFetching: true,
            error: null,
        });
        renderRoute();

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_LOADING)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
    });

    it('mounts the view once data is ready', () => {
        renderRoute();

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_LOADING)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
    });

    it('maps HTTP 422 to the invalid-json status and hides the view', () => {
        mockUseNpe.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: makeHttpError(HttpStatusCode.UnprocessableEntity, '422'),
        });
        renderRoute();
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INVALID_JSON)).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).not.toBeInTheDocument();
    });

    it('maps HTTP 500 to the unhandled-error status and hides the view', () => {
        mockUseNpe.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: makeHttpError(HttpStatusCode.InternalServerError, '500', AxiosError.ERR_BAD_RESPONSE),
        });
        renderRoute();
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_UNHANDLED_ERROR)).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).not.toBeInTheDocument();
    });
});

describe('NPE route timeline path and loading scope', () => {
    it('shows a loading spinner while the timeline query is loading', () => {
        h.params = { filepath: 'timeline.json' };
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: false, error: null });
        mockUseNPETimelineFile.mockReturnValue({ data: undefined, isLoading: true, error: null });
        renderRoute(null);

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_LOADING)).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).not.toBeInTheDocument();
    });

    it('maps timeline HTTP 422 to the invalid-json status', () => {
        h.params = { filepath: 'timeline.json' };
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: false, error: null });
        mockUseNPETimelineFile.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: makeHttpError(HttpStatusCode.UnprocessableEntity, '422'),
        });
        renderRoute(null);

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INVALID_JSON)).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).not.toBeInTheDocument();
    });

    it('ignores a loading disabled useNpe sibling when the timeline path is active', () => {
        h.params = { filepath: 'timeline.json' };
        mockUseNpe.mockReturnValue({ data: undefined, isLoading: true, error: null });
        mockUseNPETimelineFile.mockReturnValue({
            data: minimalValidNpeData,
            isLoading: false,
            error: null,
        });
        renderRoute(null);

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_LOADING)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
    });

    it('ignores a stale error on a disabled useNpe sibling when the timeline path is active', () => {
        h.params = { filepath: 'timeline.json' };
        mockUseNpe.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: makeHttpError(HttpStatusCode.InternalServerError, 'stale'),
        });
        mockUseNPETimelineFile.mockReturnValue({
            data: minimalValidNpeData,
            isLoading: false,
            error: null,
        });
        renderRoute(null);

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_UNHANDLED_ERROR)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
    });

    it('ignores a loading disabled timeline sibling when the hosted useNpe path is active', () => {
        mockUseNpe.mockReturnValue(settledNpe);
        mockUseNPETimelineFile.mockReturnValue({ data: undefined, isLoading: true, error: null });
        renderRoute();

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_LOADING)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
    });

    it('ignores a stale error on a disabled timeline sibling when the hosted useNpe path is active', () => {
        mockUseNpe.mockReturnValue(settledNpe);
        mockUseNPETimelineFile.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: makeHttpError(HttpStatusCode.InternalServerError, 'stale-timeline'),
        });
        renderRoute();

        expect(screen.queryByTestId(TEST_IDS.NPE_PROCESSING_UNHANDLED_ERROR)).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument();
    });
});
