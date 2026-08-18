// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Endpoints from '../src/definitions/Endpoints';
import { ReportKind, ReportSource, UsageEvent, UsageView } from '../src/definitions/UsageEvent';

const serverConfigMock = vi.hoisted(() =>
    vi.fn(() => ({ SERVER_MODE: false, USAGE_RECORDING_ACTIVE: true, BASE_PATH: '/' })),
);

vi.mock('../src/functions/getServerConfig', () => ({ default: serverConfigMock }));
vi.mock('../src/libs/axiosInstance', () => ({
    default: { post: vi.fn() },
    getOrCreateInstanceId: vi.fn(() => 'test-instance'),
}));

const REPORT_LOADED = {
    event: UsageEvent.REPORT_LOADED,
    details: { kind: ReportKind.PROFILER, source: ReportSource.UPLOAD },
} as const;

const VIEW_OPENED = {
    event: UsageEvent.VIEW_OPENED,
    details: { view: UsageView.OPERATIONS },
} as const;

// Mirrors MAX_BUFFERED_EVENTS. Duplicated rather than imported so a change to the module
// constant fails a test rather than silently redefining what these assert.
const MAX_BUFFERED_EVENTS = 50;
const FLUSH_INTERVAL_MS = 30_000;

/**
 * A fresh copy of the sender per test.
 *
 * The module holds a buffer and a memoised gate, and `vitest.setup.ts` only resets modules
 * in `beforeAll`, so without this every test would inherit the previous one's state.
 */
async function loadRecorder() {
    vi.resetModules();

    const axiosInstance = await import('../src/libs/axiosInstance');
    const recordUsage = await import('../src/functions/recordUsage');

    return {
        recordUsage: recordUsage.default,
        flushUsage: recordUsage.flushUsage,
        initUsageRecording: recordUsage.initUsageRecording,
        post: vi.mocked(axiosInstance.default.post),
    };
}

let sendBeacon: ReturnType<typeof vi.fn>;

// Listeners live on the shared jsdom document, so one left attached outlives the module
// instance that owns it and flushes that instance's buffer into the next test. Torn down
// centrally rather than per test, because forgetting once produces a confusing failure
// several tests later.
let stopRecording: (() => void) | null = null;

function startRecording(init: () => () => void): () => void {
    stopRecording = init();

    return stopRecording;
}

beforeEach(() => {
    vi.clearAllMocks();
    serverConfigMock.mockReturnValue({ SERVER_MODE: false, USAGE_RECORDING_ACTIVE: true, BASE_PATH: '/' });

    sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });

    // jsdom provides neither, and the sender's fallback path is what runs in that case —
    // pinned explicitly so a future jsdom that adds them does not quietly change which
    // branch these tests cover.
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.stubGlobal('cancelIdleCallback', undefined);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
});

afterEach(() => {
    stopRecording?.();
    stopRecording = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('recordUsage batching', () => {
    it('sends one request carrying every buffered event, not one per event', async () => {
        const { recordUsage, flushUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        recordUsage(REPORT_LOADED);
        recordUsage(VIEW_OPENED);
        flushUsage();

        expect(post).toHaveBeenCalledTimes(1);
        // The body shape, not merely the count: a flattened payload passes a call-count
        // assertion and is rejected outright by the real endpoint's closed-envelope check.
        expect(post).toHaveBeenCalledWith(Endpoints.USAGE, {
            events: [REPORT_LOADED, VIEW_OPENED],
        });
    });

    it('nests details rather than flattening them beside the event name', async () => {
        const { recordUsage, flushUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        recordUsage(REPORT_LOADED);
        flushUsage();

        const [, body] = post.mock.calls[0];
        const [event] = (body as { events: Record<string, unknown>[] }).events;

        expect(Object.keys(event).sort()).toEqual(['details', 'event']);
        expect(event.details).toEqual({ kind: 'profiler', source: 'upload' });
    });

    it('flushes immediately once the buffer reaches the batch cap', async () => {
        const { recordUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        for (let index = 0; index < MAX_BUFFERED_EVENTS; index++) {
            recordUsage(VIEW_OPENED);
        }

        expect(post).toHaveBeenCalledTimes(1);
        expect((post.mock.calls[0][1] as { events: unknown[] }).events).toHaveLength(MAX_BUFFERED_EVENTS);
    });

    it('does nothing when the buffer is empty', async () => {
        const { flushUsage, post } = await loadRecorder();

        flushUsage();

        expect(post).not.toHaveBeenCalled();
    });
});

describe('recordUsage flush triggers', () => {
    it('flushes once on the idle fallback and does not flush again on the interval', async () => {
        const { recordUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        recordUsage(VIEW_OPENED);
        vi.advanceTimersByTime(FLUSH_INTERVAL_MS);

        expect(post).toHaveBeenCalledTimes(1);
    });

    it('beacons on pagehide without touching axios', async () => {
        const { recordUsage, initUsageRecording, post } = await loadRecorder();
        startRecording(initUsageRecording);

        recordUsage(VIEW_OPENED);
        window.dispatchEvent(new Event('pagehide'));

        expect(sendBeacon).toHaveBeenCalledTimes(1);
        expect(post).not.toHaveBeenCalled();

        const [url, blob] = sendBeacon.mock.calls[0];

        expect(url).toBe('/api/usage');
        // The type is load-bearing: it makes the request non-simple, and a bare-string
        // beacon would go as text/plain and be refused by the route.
        expect((blob as Blob).type).toBe('application/json');
    });

    it('beacons when the tab is hidden', async () => {
        const { recordUsage, initUsageRecording } = await loadRecorder();
        startRecording(initUsageRecording);

        recordUsage(VIEW_OPENED);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));

        expect(sendBeacon).toHaveBeenCalledTimes(1);
    });

    it('does not flush when the tab becomes visible', async () => {
        const { recordUsage, initUsageRecording, post } = await loadRecorder();
        startRecording(initUsageRecording);

        recordUsage(VIEW_OPENED);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));

        expect(sendBeacon).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });

    it('falls back to a post when a hidden-tab beacon is refused, but not on pagehide', async () => {
        const { recordUsage, initUsageRecording, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });
        sendBeacon.mockReturnValue(false);

        startRecording(initUsageRecording);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        recordUsage(VIEW_OPENED);
        document.dispatchEvent(new Event('visibilitychange'));

        expect(post).toHaveBeenCalledTimes(1);

        // On pagehide the document is being discarded, so an async post would not reliably
        // run; the batch is dropped instead of pretending otherwise.
        recordUsage(VIEW_OPENED);
        window.dispatchEvent(new Event('pagehide'));

        expect(post).toHaveBeenCalledTimes(1);
    });

    it('stops flushing after teardown', async () => {
        const { recordUsage, initUsageRecording } = await loadRecorder();
        const teardown = startRecording(initUsageRecording);

        teardown();
        recordUsage(VIEW_OPENED);
        window.dispatchEvent(new Event('pagehide'));

        expect(sendBeacon).not.toHaveBeenCalled();
    });
});

describe('recordUsage gating', () => {
    it.each([
        ['recording is switched off', { SERVER_MODE: false, USAGE_RECORDING_ACTIVE: false, BASE_PATH: '/' }],
        ['the app is in server mode', { SERVER_MODE: true, USAGE_RECORDING_ACTIVE: true, BASE_PATH: '/' }],
    ])('sends nothing when %s', async (_label, config) => {
        serverConfigMock.mockReturnValue(config);

        const { recordUsage, flushUsage, initUsageRecording, post } = await loadRecorder();
        const teardown = startRecording(initUsageRecording);

        recordUsage(REPORT_LOADED);
        flushUsage();
        window.dispatchEvent(new Event('pagehide'));
        vi.advanceTimersByTime(FLUSH_INTERVAL_MS);

        expect(post).not.toHaveBeenCalled();
        expect(sendBeacon).not.toHaveBeenCalled();
        expect(teardown).not.toThrow();
    });
});

describe('recordUsage failure handling', () => {
    it('swallows a rejected post', async () => {
        const { recordUsage, flushUsage, post } = await loadRecorder();
        post.mockRejectedValue(new Error('no endpoint'));

        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);

        recordUsage(VIEW_OPENED);
        flushUsage();
        await vi.waitFor(() => expect(post).toHaveBeenCalled());

        process.off('unhandledRejection', unhandled);
        expect(unhandled).not.toHaveBeenCalled();
    });

    it('drops a failed batch rather than re-buffering it', async () => {
        const { recordUsage, flushUsage, post } = await loadRecorder();
        post.mockRejectedValue(new Error('no endpoint'));

        recordUsage(VIEW_OPENED);
        flushUsage();
        await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));

        // A second flush finds nothing: re-buffering would resubmit a malformed batch
        // forever and grow without bound against a dead endpoint.
        flushUsage();

        expect(post).toHaveBeenCalledTimes(1);
    });
});

describe('getUsageEndpointUrl', () => {
    it.each([
        ['/', '/api/usage'],
        ['/ttnn/', '/ttnn/api/usage'],
        ['/ttnn', '/ttnn/api/usage'],
    ])('composes %s into %s', async (basePath, expected) => {
        serverConfigMock.mockReturnValue({ SERVER_MODE: false, USAGE_RECORDING_ACTIVE: true, BASE_PATH: basePath });

        const { recordUsage, initUsageRecording } = await loadRecorder();
        startRecording(initUsageRecording);

        recordUsage(VIEW_OPENED);
        window.dispatchEvent(new Event('pagehide'));

        expect(sendBeacon.mock.calls[0][0]).toBe(expected);
    });
});
