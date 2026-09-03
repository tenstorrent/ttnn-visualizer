// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const MIN_BATCH_WINDOW_MS = 2_000;
const IDLE_FLUSH_TIMEOUT_MS = 2_000;
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

// Collected for the lifetime of the file. Registering and removing the listener around a
// single `await` cannot work: Node emits `unhandledRejection` after the microtask queue
// drains, by which point the listener is already gone — so the assertion passed whether or
// not the rejection was handled, which is how a missing `.catch` went unnoticed.
const unhandledRejections: unknown[] = [];
const captureUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

beforeAll(() => process.on('unhandledRejection', captureUnhandledRejection));
afterAll(() => process.off('unhandledRejection', captureUnhandledRejection));

/**
 * Read a Blob's bytes.
 *
 * jsdom's Blob exposes only `slice`, `size` and `type` — no `text()` or `arrayBuffer()` —
 * and Node's `Response` will not accept it across realms, so FileReader is the way in.
 * Needs real timers because its completion is not a fake-timer task.
 */
async function readBlobText(blob: Blob): Promise<string> {
    vi.useRealTimers();

    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}

/** Give Node a real macrotask turn so any unhandled rejection has been emitted. */
async function settleRejections(): Promise<void> {
    vi.useRealTimers();
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

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
    unhandledRejections.length = 0;
    serverConfigMock.mockReturnValue({ SERVER_MODE: false, USAGE_RECORDING_ACTIVE: true, BASE_PATH: '/' });

    sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });

    // jsdom provides neither, and the sender's fallback path is what runs in that case —
    // pinned explicitly so a future jsdom that adds them does not quietly change which
    // branch these tests cover. The idle path real browsers take has its own describe
    // block below, which restubs both as callable fakes.
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

    it('sends a full buffer on the scheduled flush rather than inline', async () => {
        const { recordUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        for (let index = 0; index < MAX_BUFFERED_EVENTS; index++) {
            recordUsage(VIEW_OPENED);
        }

        // Nothing yet: a synchronous post here would land on the caller's tick, which for
        // an interaction-wired event is the render path the module exists to stay off.
        expect(post).not.toHaveBeenCalled();

        vi.advanceTimersByTime(MIN_BATCH_WINDOW_MS);

        expect(post).toHaveBeenCalledTimes(1);
        expect((post.mock.calls[0][1] as { events: unknown[] }).events).toHaveLength(MAX_BUFFERED_EVENTS);
    });

    it('bounds the request rate under a burst, dropping the overflow', async () => {
        const { recordUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        // The shape a VIEW_ENGAGED wired to scroll would produce on a large table.
        for (let index = 0; index < 5_000; index++) {
            recordUsage(VIEW_OPENED);
        }

        vi.advanceTimersByTime(MIN_BATCH_WINDOW_MS);

        // One request for the window, not one per fifty events. Everything past the cap is
        // dropped, which is the deliberate trade over issuing 100 posts mid-gesture.
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

    it('coalesces over the batch window rather than posting on the first event', async () => {
        const { recordUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        recordUsage(VIEW_OPENED);
        vi.advanceTimersByTime(MIN_BATCH_WINDOW_MS - 1);

        expect(post).not.toHaveBeenCalled();

        recordUsage(REPORT_LOADED);
        vi.advanceTimersByTime(1);

        // Both events in one request: the window is a floor on batching, which is what an
        // unguarded requestIdleCallback would destroy by firing within a frame.
        expect(post).toHaveBeenCalledTimes(1);
        expect((post.mock.calls[0][1] as { events: unknown[] }).events).toHaveLength(2);
    });

    it('re-arms after a flush, so later events are not stranded', async () => {
        const { recordUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        recordUsage(VIEW_OPENED);
        vi.advanceTimersByTime(MIN_BATCH_WINDOW_MS);

        expect(post).toHaveBeenCalledTimes(1);

        // Scheduling early-returns while a flush is armed, so clearing the handle is the
        // only thing that lets a second one be scheduled. Without it every event after the
        // first flush would wait for the 50-event cap or a beacon.
        recordUsage(REPORT_LOADED);
        vi.advanceTimersByTime(MIN_BATCH_WINDOW_MS);

        expect(post).toHaveBeenCalledTimes(2);
        expect((post.mock.calls[1][1] as { events: unknown[] }).events).toEqual([REPORT_LOADED]);
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

        // And the bytes, not just the wrapper. This is the path every real tab close
        // takes, and a flattened envelope would pass a type check while the route's
        // closed-envelope validation rejects it outright.
        expect(JSON.parse(await readBlobText(blob as Blob))).toEqual({ events: [VIEW_OPENED] });
    });

    it('drains the buffer, so hiding then closing sends one beacon not two', async () => {
        const { recordUsage, initUsageRecording } = await loadRecorder();
        startRecording(initUsageRecording);

        recordUsage(VIEW_OPENED);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pagehide'));

        // Hide-then-close is a common sequence, and the batch is spliced out before the
        // send precisely so the second trigger finds nothing left to count again.
        expect(sendBeacon).toHaveBeenCalledTimes(1);
    });

    it('attempts no post during document discard when the beacon is refused', async () => {
        const { recordUsage, initUsageRecording, post } = await loadRecorder();
        startRecording(initUsageRecording);
        sendBeacon.mockReturnValue(false);

        recordUsage(VIEW_OPENED);

        // Real browsers fire pagehide before the visibility state flips, so the drop wins
        // and the hidden handler finds an empty buffer. Pinned as a sequence because each
        // trigger is otherwise only tested alone, and the order is what keeps a post off
        // the discard path.
        window.dispatchEvent(new Event('pagehide'));
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));

        expect(sendBeacon).toHaveBeenCalledTimes(1);
        expect(post).not.toHaveBeenCalled();
    });

    it('drains what is buffered on teardown rather than stranding it', async () => {
        const { recordUsage, initUsageRecording, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        const teardown = startRecording(initUsageRecording);

        recordUsage(VIEW_OPENED);
        teardown();

        // Teardown removes the pagehide listener and cancels the pending flush, so
        // anything still held would otherwise be lost if the tab closed next.
        expect(post).toHaveBeenCalledTimes(1);
        expect((post.mock.calls[0][1] as { events: unknown[] }).events).toEqual([VIEW_OPENED]);
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

describe('recordUsage idle scheduling', () => {
    // The branch every real browser takes. The rest of the file stubs both callbacks away
    // to pin the fallback, which left the production path — and its cancellation — with no
    // coverage at all: a leaked idle callback firing after teardown would go unnoticed.
    let idleCallbacks: Map<number, IdleRequestCallback>;
    let requestIdle: ReturnType<typeof vi.fn>;
    let cancelIdle: ReturnType<typeof vi.fn>;
    let nextIdleHandle: number;

    beforeEach(() => {
        idleCallbacks = new Map();
        nextIdleHandle = 1;

        requestIdle = vi.fn((callback: IdleRequestCallback) => {
            const handle = nextIdleHandle;
            nextIdleHandle += 1;
            idleCallbacks.set(handle, callback);

            return handle;
        });
        cancelIdle = vi.fn((handle: number) => idleCallbacks.delete(handle));

        vi.stubGlobal('requestIdleCallback', requestIdle);
        vi.stubGlobal('cancelIdleCallback', cancelIdle);
    });

    function runIdleCallbacks(): void {
        const pending = [...idleCallbacks.values()];
        idleCallbacks.clear();
        pending.forEach((callback) => callback({ didTimeout: false, timeRemaining: () => 0 }));
    }

    it('arms the idle callback only once the batch window closes', async () => {
        const { recordUsage } = await loadRecorder();

        recordUsage(VIEW_OPENED);

        expect(requestIdle).not.toHaveBeenCalled();

        vi.advanceTimersByTime(MIN_BATCH_WINDOW_MS);

        expect(requestIdle).toHaveBeenCalledTimes(1);
        expect(requestIdle.mock.calls[0][1]).toEqual({ timeout: IDLE_FLUSH_TIMEOUT_MS });
    });

    it('posts when the idle callback runs', async () => {
        const { recordUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        recordUsage(VIEW_OPENED);
        vi.advanceTimersByTime(MIN_BATCH_WINDOW_MS);

        expect(post).not.toHaveBeenCalled();

        runIdleCallbacks();

        expect(post).toHaveBeenCalledTimes(1);
    });

    it('cancels the idle callback and the ceiling on teardown', async () => {
        const { recordUsage, initUsageRecording, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        const teardown = startRecording(initUsageRecording);

        recordUsage(VIEW_OPENED);
        vi.advanceTimersByTime(MIN_BATCH_WINDOW_MS);
        teardown();

        expect(cancelIdle).toHaveBeenCalledTimes(1);

        // Teardown drains what was buffered, so one post is expected here. What must not
        // happen is a second one: both timers cleared, not just the idle handle, or a
        // surviving ceiling would fire into a torn-down module.
        expect(post).toHaveBeenCalledTimes(1);

        runIdleCallbacks();
        vi.advanceTimersByTime(FLUSH_INTERVAL_MS);

        expect(post).toHaveBeenCalledTimes(1);
    });

    it('still flushes when the tab is hidden and no idle period ever arrives', async () => {
        const { recordUsage, post } = await loadRecorder();
        post.mockResolvedValue({ status: 204 });

        recordUsage(VIEW_OPENED);
        // A hidden tab runs no idle callbacks, which is what the ceiling is for.
        vi.advanceTimersByTime(FLUSH_INTERVAL_MS);

        expect(post).toHaveBeenCalledTimes(1);
    });
});

describe('recordUsage gating', () => {
    it('sends nothing when recording is switched off', async () => {
        serverConfigMock.mockReturnValue({ SERVER_MODE: true, USAGE_RECORDING_ACTIVE: false, BASE_PATH: '/' });

        const { recordUsage, flushUsage, initUsageRecording, post } = await loadRecorder();
        const teardown = startRecording(initUsageRecording);

        recordUsage(VIEW_OPENED);
        flushUsage();
        window.dispatchEvent(new Event('pagehide'));
        vi.advanceTimersByTime(FLUSH_INTERVAL_MS);

        expect(post).not.toHaveBeenCalled();
        expect(sendBeacon).not.toHaveBeenCalled();
        expect(teardown).not.toThrow();
    });

    it('records in server mode when the published switch is active', async () => {
        serverConfigMock.mockReturnValue({ SERVER_MODE: true, USAGE_RECORDING_ACTIVE: true, BASE_PATH: '/' });

        const { recordUsage, flushUsage, initUsageRecording, post } = await loadRecorder();
        startRecording(initUsageRecording);

        recordUsage(VIEW_OPENED);
        flushUsage();

        expect(post).toHaveBeenCalledTimes(1);
    });
});

describe('recordUsage failure handling', () => {
    it('swallows a rejected post', async () => {
        const { recordUsage, flushUsage, post } = await loadRecorder();
        post.mockRejectedValue(new Error('no endpoint'));

        recordUsage(VIEW_OPENED);
        flushUsage();
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
        await settleRejections();

        expect(unhandledRejections).toEqual([]);
    });

    it('reports the refusal status in dev, and never the response body', async () => {
        const { recordUsage, flushUsage, post } = await loadRecorder();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // axios resolves only on 2xx, so a 422 arrives as a rejection carrying a response.
        // Warning solely from the success path left this unable to report the one case the
        // diagnostic exists for: a vocabulary mismatch the server rejects and nothing says.
        post.mockRejectedValue({ response: { status: 422, data: { error: 'Unknown usage event' } } });

        recordUsage(VIEW_OPENED);
        flushUsage();
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());

        const [message] = warn.mock.calls[0];

        expect(message).toContain('422');
        expect(message).not.toContain('Unknown usage event');
    });

    it('reports a post that never reached the server', async () => {
        const { recordUsage, flushUsage, post } = await loadRecorder();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // No response at all — offline, or no server listening.
        post.mockRejectedValue(new Error('Network Error'));

        recordUsage(VIEW_OPENED);
        flushUsage();
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());

        expect(warn.mock.calls[0][0]).toContain('could not be delivered');
    });

    it('says nothing when the server accepts the batch', async () => {
        const { recordUsage, flushUsage, post } = await loadRecorder();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        post.mockResolvedValue({ status: 204 });

        recordUsage(VIEW_OPENED);
        flushUsage();
        await vi.waitFor(() => expect(post).toHaveBeenCalled());

        expect(warn).not.toHaveBeenCalled();
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
