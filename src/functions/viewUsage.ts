// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type Location, matchPath } from 'react-router';
import ROUTES, { ROUTE_PATTERNS } from '../definitions/Routes';
import { UsageEvent, UsageView } from '../definitions/UsageEvent';
import { isModalOpen } from './modalRoute';
import recordUsage from './recordUsage';

type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

type RouteUsageDefinition =
    | { view: UsageView; requiresModalBackground?: true }
    | { view: UsageView; pattern: string; nestedView?: UsageView };

/**
 * The single inventory of which application routes are countable views.
 *
 * `null` is an explicit exclusion rather than an omitted key, so adding a route
 * without deciding how it should be counted fails type-checking.
 */
export const USAGE_VIEW_BY_ROUTE = Object.freeze({
    [ROUTES.HOME]: { view: UsageView.REPORTS },
    [ROUTES.OPERATIONS]: {
        view: UsageView.OPERATIONS,
        pattern: ROUTE_PATTERNS.OPERATION_DETAILS,
        nestedView: UsageView.OPERATION_DETAILS,
    },
    [ROUTES.TENSORS]: { view: UsageView.TENSORS },
    [ROUTES.BUFFERS]: { view: UsageView.BUFFERS },
    [ROUTES.STYLEGUIDE]: null,
    [ROUTES.GRAPHTREE]: { view: UsageView.GRAPH, pattern: ROUTE_PATTERNS.GRAPHTREE },
    [ROUTES.PERFORMANCE]: { view: UsageView.PERFORMANCE },
    [ROUTES.NPE]: { view: UsageView.NPE, pattern: ROUTE_PATTERNS.NPE },
    [ROUTES.MLIR]: { view: UsageView.MLIR, pattern: ROUTE_PATTERNS.MLIR },
    [ROUTES.CLUSTER]: { view: UsageView.TOPOLOGY, requiresModalBackground: true },
}) satisfies Readonly<Record<RoutePath, RouteUsageDefinition | null>>;

const ROUTE_USAGE_ENTRIES = Object.entries(USAGE_VIEW_BY_ROUTE) as [RoutePath, RouteUsageDefinition | null][];

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

export function getUsageView(location: Pick<Location, 'pathname' | 'state'>): UsageView | null {
    for (const [route, definition] of ROUTE_USAGE_ENTRIES) {
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

export function recordViewOpened(view: UsageView): void {
    recordUsage({ event: UsageEvent.VIEW_OPENED, details: { view } });
}
