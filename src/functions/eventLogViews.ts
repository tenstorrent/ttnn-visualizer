// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type Location, matchPath } from 'react-router';
import ROUTES, { ROUTE_PATTERNS } from '../definitions/Routes';
import { EventLogEvent, EventLogView } from '../definitions/EventLogEvent';
import { isModalOpen } from './modalRoute';
import recordEvent from './recordEvent';

type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

type RouteEventLogViewDefinition =
    | { view: EventLogView; requiresModalBackground?: true }
    | { view: EventLogView; pattern: string; nestedView?: EventLogView };

/**
 * The single inventory of which application routes are countable views.
 *
 * `null` is an explicit exclusion rather than an omitted key, so adding a route
 * without deciding how it should be counted fails type-checking.
 */
export const EVENT_LOG_VIEW_BY_ROUTE = Object.freeze({
    [ROUTES.HOME]: { view: EventLogView.REPORTS },
    [ROUTES.OPERATIONS]: {
        view: EventLogView.OPERATIONS,
        pattern: ROUTE_PATTERNS.OPERATION_DETAILS,
        nestedView: EventLogView.OPERATION_DETAILS,
    },
    [ROUTES.TENSORS]: { view: EventLogView.TENSORS },
    [ROUTES.BUFFERS]: { view: EventLogView.BUFFERS },
    [ROUTES.STYLEGUIDE]: null,
    [ROUTES.GRAPHTREE]: { view: EventLogView.GRAPH, pattern: ROUTE_PATTERNS.GRAPHTREE },
    [ROUTES.PERFORMANCE]: { view: EventLogView.PERFORMANCE },
    [ROUTES.NPE]: { view: EventLogView.NPE, pattern: ROUTE_PATTERNS.NPE },
    [ROUTES.MLIR]: { view: EventLogView.MLIR, pattern: ROUTE_PATTERNS.MLIR },
    [ROUTES.CLUSTER]: { view: EventLogView.TOPOLOGY, requiresModalBackground: true },
}) satisfies Readonly<Record<RoutePath, RouteEventLogViewDefinition | null>>;

const ROUTE_EVENT_LOG_VIEW_ENTRIES = Object.entries(EVENT_LOG_VIEW_BY_ROUTE) as [
    RoutePath,
    RouteEventLogViewDefinition | null,
][];

let lastSeenPathname: string | null = null;

export function resetRememberedViewPathname(): void {
    lastSeenPathname = null;
}

/**
 * True when this pathname is a new view location. Survives a shell remount so a
 * `ProtectedRoute` bounce cannot reopen the page it lands on.
 */
export function rememberViewPathname(pathname: string): boolean {
    if (lastSeenPathname === pathname) {
        return false;
    }

    lastSeenPathname = pathname;
    return true;
}

export function getEventLogView(location: Pick<Location, 'pathname' | 'state'>): EventLogView | null {
    for (const [route, definition] of ROUTE_EVENT_LOG_VIEW_ENTRIES) {
        if (matchPath({ path: route, end: true }, location.pathname)) {
            if (definition && 'requiresModalBackground' in definition && definition.requiresModalBackground) {
                return isModalOpen(location, route) ? definition.view : null;
            }

            return definition?.view ?? null;
        }

        if (definition && 'pattern' in definition) {
            const matched = matchPath(
                {
                    path: definition.pattern,
                    end: true,
                },
                location.pathname,
            );

            if (matched) {
                return definition.nestedView ?? definition.view;
            }
        }
    }

    return null;
}

export function recordViewOpened(view: EventLogView): void {
    recordEvent({ event: EventLogEvent.VIEW_OPENED, details: { view } });
}
