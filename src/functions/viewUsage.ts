// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { matchPath } from 'react-router';
import ROUTES, { ROUTE_PATTERNS } from '../definitions/Routes';
import { UsageEvent, UsageView } from '../definitions/UsageEvent';
import recordUsage from './recordUsage';

type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

interface RouteUsageDefinition {
    view: UsageView;
    pattern?: string;
    nestedView?: UsageView;
}

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
    [ROUTES.GRAPHTREE]: { view: UsageView.GRAPH, pattern: ROUTE_PATTERNS.GRAPHTREE, nestedView: UsageView.GRAPH },
    [ROUTES.PERFORMANCE]: { view: UsageView.PERFORMANCE },
    [ROUTES.NPE]: { view: UsageView.NPE, pattern: ROUTE_PATTERNS.NPE, nestedView: UsageView.NPE },
    [ROUTES.MLIR]: { view: UsageView.MLIR, pattern: ROUTE_PATTERNS.MLIR, nestedView: UsageView.MLIR },
    [ROUTES.CLUSTER]: { view: UsageView.TOPOLOGY },
}) satisfies Readonly<Record<RoutePath, RouteUsageDefinition | null>>;

const ROUTE_USAGE_ENTRIES = Object.entries(USAGE_VIEW_BY_ROUTE) as [RoutePath, RouteUsageDefinition | null][];

export function getUsageView(pathname: string): UsageView | null {
    for (const [route, definition] of ROUTE_USAGE_ENTRIES) {
        if (matchPath({ path: route, end: true }, pathname)) {
            return definition?.view ?? null;
        }

        if (
            definition?.nestedView &&
            definition.pattern &&
            matchPath(
                {
                    path: definition.pattern,
                    end: true,
                },
                pathname,
            )
        ) {
            return definition.nestedView;
        }
    }

    return null;
}

export function recordViewOpened(view: UsageView): void {
    recordUsage({ event: UsageEvent.VIEW_OPENED, details: { view } });
}
