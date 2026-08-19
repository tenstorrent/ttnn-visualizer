// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { HttpStatusCode } from 'axios';
import Endpoints from '../definitions/Endpoints';
import { UsageEventPayload } from '../definitions/UsageEvent';
import axiosInstance from '../libs/axiosInstance';
import getServerConfig from './getServerConfig';
import isUsageRecordingEnabled from './isUsageRecordingEnabled';

/**
 * Buffered, best-effort sender for local usage events.
 *
 * Events are held in memory and posted off the render path: recording one costs a
 * predicate and an array push, because the views this instruments include the NPE
 * timeline and the performance table, where per-frame or per-row work is the thing the
 * canvas rules in AGENTS.md exist to prevent.
 *
 * Failures are silent and unretried. The endpoint answers 204 whether it wrote, whether
 * recording is switched off locally, and whether the batch was dropped, so there is
 * nothing here a caller could act on — and instrumentation must never destabilise the
 * application it measures.
 */

// Mirrors MAX_USAGE_BATCH_EVENTS in backend/ttnn_visualizer/usage.py, which bounds the
// atomicity of a single append rather than merely an HTTP body. test_usage_frontend_parity
// pins the two equal so a batch this client builds can never be refused wholesale.
const MAX_BUFFERED_EVENTS = 50;

// The minimum window events coalesce over. `requestIdleCallback` is armed only after it
// elapses, never on the first buffered event: its `timeout` is an upper bound on the delay,
// not a lower one, so on a quiet tab the next idle period arrives within a frame and each
// event would get its own request — the opposite of batching.
const MIN_BATCH_WINDOW_MS = 2_000;

// How long the flush may then wait for an actual idle moment before going anyway.
const IDLE_FLUSH_TIMEOUT_MS = 2_000;

// The ceiling. Still meaningful despite the two above: a hidden tab runs no idle callbacks
// at all, so this is what eventually drains a buffer filled just before the tab was hidden.
const FLUSH_INTERVAL_MS = 30_000;

const buffer: UsageEventPayload[] = [];

let cancelScheduledFlush: (() => void) | null = null;

function getUsageEndpointUrl(): string {
    // A beacon bypasses axios and so gets neither its baseURL nor its instanceId param.
    // Joined the way axios's combineURLs does, or a deployment under a non-root BASE_PATH
    // would post to a path that does not exist and never find out.
    const basePath = getServerConfig().BASE_PATH || '/';

    return `${basePath.replace(/\/+$/, '')}/${String(Endpoints.USAGE).replace(/^\/+/, '')}`;
}

function warnOnUnexpectedOutcome(status: number | null): void {
    // Both sides are silent by design, which is right in production and hostile while
    // events are being wired: a mistyped enum value or a renamed detail key is a 422 that
    // nothing anywhere reports. The status only — echoing a response body would put server
    // text back into a subsystem whose whole point is that it holds none.
    //
    // Called from the rejection path as well as the success path, because axios resolves
    // only on 2xx: a 422 never reaches `.then`, so warning there alone left this unable to
    // report the single case it exists for.
    if (!import.meta.env.DEV || status === HttpStatusCode.NoContent) {
        return;
    }

    const reason =
        status === null
            ? 'could not be delivered'
            : `were refused with status ${status}, so the client and server vocabularies may disagree`;

    // eslint-disable-next-line no-console -- dev-only, and there is no UI that could carry this.
    console.warn(`Usage events ${reason}.`);
}

function postEvents(events: UsageEventPayload[]): void {
    // One sender for both callers, so a header, timeout or signal added later cannot land
    // on one path and not the other — a divergence neither side would report.
    axiosInstance
        .post(Endpoints.USAGE, { events })
        .then((response) => warnOnUnexpectedOutcome(response.status))
        // Dropped, never re-buffered: a refused or unreachable endpoint would otherwise
        // grow the buffer without bound for the life of the tab, and a batch rejected for
        // being malformed would be resubmitted forever. A transport failure has no
        // response at all, hence the null.
        .catch((error) => warnOnUnexpectedOutcome(error?.response?.status ?? null));
}

function takeBatch(): UsageEventPayload[] {
    // Emptied before the request rather than after, so a batch is never sent twice and the
    // buffer cannot grow past its cap while one is in flight.
    return buffer.splice(0, MAX_BUFFERED_EVENTS);
}

function clearScheduledFlush(): void {
    cancelScheduledFlush?.();
    cancelScheduledFlush = null;
}

function scheduleFlush(): void {
    if (cancelScheduledFlush) {
        return;
    }

    // Armed once the coalescing window closes, so the idle callback decides *when* within
    // an idle period to flush rather than how much was batched.
    let cancelIdle: (() => void) | null = null;

    const windowHandle = setTimeout(() => {
        // jsdom has no requestIdleCallback and Safari only shipped it recently, so the
        // straight-to-flush path is load-bearing for the test suite as well as for users.
        // Written as a positive guard because that is the shape `compat/compat` recognises
        // as guarding the call — inverted, it reports the unsupported browsers instead.
        if (typeof requestIdleCallback === 'function') {
            const idleHandle = requestIdleCallback(flushUsage, { timeout: IDLE_FLUSH_TIMEOUT_MS });
            cancelIdle = () => cancelIdleCallback(idleHandle);
        } else {
            flushUsage();
        }
    }, MIN_BATCH_WINDOW_MS);

    // The ceiling runs alongside rather than after: whichever loses finds an empty buffer.
    const intervalHandle = setTimeout(flushUsage, FLUSH_INTERVAL_MS);

    cancelScheduledFlush = () => {
        clearTimeout(windowHandle);
        clearTimeout(intervalHandle);
        cancelIdle?.();
    };
}

export function flushUsage(): void {
    clearScheduledFlush();

    if (buffer.length === 0) {
        return;
    }

    postEvents(takeBatch());
}

function flushUsageViaBeacon(allowFallback: boolean): void {
    clearScheduledFlush();

    if (buffer.length === 0) {
        return;
    }

    const events = takeBatch();
    const body = JSON.stringify({ events });

    // The Blob type is mandatory rather than defensive. The route requires
    // application/json so that the request is non-simple and a hostile origin needs a
    // preflight ALLOWED_ORIGINS refuses; a bare string beacon is sent as text/plain and
    // would be rejected.
    const sent =
        typeof navigator.sendBeacon === 'function' &&
        navigator.sendBeacon(getUsageEndpointUrl(), new Blob([body], { type: 'application/json' }));

    if (sent) {
        return;
    }

    // On pagehide the document is being discarded and an async post is not guaranteed to
    // run, so falling back there would read as a safety net while being close to dead
    // code. A hidden tab usually survives, so it is worth trying.
    if (allowFallback) {
        postEvents(events);
    }
}

export default function recordUsage(payload: UsageEventPayload): void {
    if (!isUsageRecordingEnabled()) {
        return;
    }

    // Defensive: the buffer is emptied synchronously on flush, so it should never be at
    // cap here. Dropping rather than growing is the deliberate answer if it ever is.
    if (buffer.length >= MAX_BUFFERED_EVENTS) {
        return;
    }

    buffer.push(payload);

    if (buffer.length >= MAX_BUFFERED_EVENTS) {
        flushUsage();
        return;
    }

    scheduleFlush();
}

function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
        flushUsageViaBeacon(true);
    }
}

function handlePageHide(): void {
    flushUsageViaBeacon(false);
}

/**
 * Start the flush lifecycle. Call once, from `Layout`; the returned teardown removes both
 * listeners.
 *
 * Registered here rather than at module scope so importing this module has no side effect,
 * so the listeners match how every other listener in this codebase is owned, and so a
 * spec resetting modules does not accumulate handlers on the same window.
 *
 * This starts the transport. It records nothing on its own — call sites emitting events
 * arrive with the events themselves.
 */
export function initUsageRecording(): () => void {
    if (!isUsageRecordingEnabled()) {
        return () => {};
    }

    // A long-lived SPA whose tabs stay open for days: a buffer that only flushed on unload
    // would lose most of what it held.
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('pagehide', handlePageHide);
        clearScheduledFlush();
    };
}
