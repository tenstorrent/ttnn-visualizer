// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { HttpStatusCode } from 'axios';
import Endpoints from '../definitions/Endpoints';
import { EventLogEventPayload } from '../definitions/EventLogEvent';
import axiosInstance from '../libs/axiosInstance';
import getServerConfig from './getServerConfig';
import isEventLoggingEnabled from './isEventLoggingEnabled';

/**
 * Buffered, best-effort sender for local events.
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

// Mirrors MAX_EVENT_LOG_BATCH_EVENTS in backend/ttnn_visualizer/event_logging.py, which bounds the
// atomicity of a single append rather than merely an HTTP body. test_event_logging_frontend_parity
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

const buffer: EventLogEventPayload[] = [];

let cancelScheduledFlush: (() => void) | null = null;

function getEventLogEndpointUrl(): string {
    // A beacon bypasses axios and so gets neither its baseURL nor its instanceId param.
    // Joined the way axios's combineURLs does, or a deployment under a non-root BASE_PATH
    // would post to a path that does not exist and never find out.
    const basePath = getServerConfig().BASE_PATH || '/';

    return `${basePath.replace(/\/+$/, '')}/${String(Endpoints.EVENT_LOGGING).replace(/^\/+/, '')}`;
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
    console.warn(`Events ${reason}.`);
}

function postEvents(events: EventLogEventPayload[]): void {
    // One sender for both callers, so a header, timeout or signal added later cannot land
    // on one path and not the other — a divergence neither side would report.
    axiosInstance
        .post(Endpoints.EVENT_LOGGING, { events })
        .then((response) => warnOnUnexpectedOutcome(response.status))
        // Dropped, never re-buffered: a refused or unreachable endpoint would otherwise
        // grow the buffer without bound for the life of the tab, and a batch rejected for
        // being malformed would be resubmitted forever. A transport failure has no
        // response at all, hence the null.
        .catch((error) => warnOnUnexpectedOutcome(error?.response?.status ?? null));
}

function takeBatch(): EventLogEventPayload[] {
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
            const idleHandle = requestIdleCallback(flushEventLog, { timeout: IDLE_FLUSH_TIMEOUT_MS });
            cancelIdle = () => cancelIdleCallback(idleHandle);
        } else {
            flushEventLog();
        }
    }, MIN_BATCH_WINDOW_MS);

    // The ceiling runs alongside rather than after: whichever loses finds an empty buffer.
    const intervalHandle = setTimeout(flushEventLog, FLUSH_INTERVAL_MS);

    cancelScheduledFlush = () => {
        clearTimeout(windowHandle);
        clearTimeout(intervalHandle);
        cancelIdle?.();
    };
}

export function flushEventLog(): void {
    clearScheduledFlush();

    if (buffer.length === 0) {
        return;
    }

    postEvents(takeBatch());
}

function flushEventLogViaBeacon(allowFallback: boolean): void {
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
        navigator.sendBeacon(getEventLogEndpointUrl(), new Blob([body], { type: 'application/json' }));

    if (sent) {
        return;
    }

    // On pagehide the document is being discarded and an async post is not guaranteed to
    // run, so falling back there would read as a safety net while being close to dead
    // code. A hidden tab usually survives, so it is worth trying.
    //
    // Which of the two runs first matters, and rests on the HTML unload algorithm firing
    // `pagehide` *before* the visibility state flips to hidden: on a real tab close the
    // drop wins and no post is attempted during discard. If a browser ever reversed that
    // order, the fallback would fire on the discard path this is written to avoid.
    if (allowFallback) {
        postEvents(events);
    }
}

export default function recordEvent(payload: EventLogEventPayload): void {
    if (!isEventLoggingEnabled()) {
        return;
    }

    // Dropped rather than buffered once full, and deliberately *not* flushed inline. A
    // synchronous post here would put the axios config build and interceptor pass on the
    // caller's tick — so an event wired to scroll or hover on the performance table would
    // issue a request per 50 interactions, as fast as the gesture produced them, on the
    // main thread. The scheduled flush drains within MIN_BATCH_WINDOW_MS instead, which
    // bounds the request rate no matter how fast a caller records. Losing the overflow is
    // the correct trade: instrumentation must never destabilise what it measures.
    if (buffer.length >= MAX_BUFFERED_EVENTS) {
        return;
    }

    buffer.push(payload);
    scheduleFlush();
}

function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
        flushEventLogViaBeacon(true);
    }
}

function handlePageHide(): void {
    flushEventLogViaBeacon(false);
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
export function initEventLogging(): () => void {
    if (!isEventLoggingEnabled()) {
        return () => {};
    }

    // A long-lived SPA whose tabs stay open for days: a buffer that only flushed on unload
    // would lose most of what it held.
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('pagehide', handlePageHide);

        // Drain rather than discard. Teardown removes the `pagehide` listener and cancels
        // the pending flush, so anything still buffered would be stranded and then lost if
        // the tab closed before another event re-armed the schedule. `flushEventLog` clears
        // the schedule itself, and is a no-op on an empty buffer — which is the StrictMode
        // mount/unmount/mount case in dev.
        flushEventLog();
    };
}
