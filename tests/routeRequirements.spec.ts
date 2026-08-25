// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * `RouteRequirements` is derived from the navigation descriptors so a route's report
 * requirement is stated once. The two used to be independent tables, and drift between
 * them failed silently in both directions: an item the rail offered that the route guard
 * bounced straight back to Home, or an item greyed out for a route that was reachable.
 *
 * Deriving it swaps that risk for a quieter one -- a derivation that produces the wrong
 * shape, or nothing at all, still type-checks -- so the resulting table is pinned here.
 */

import { describe, expect, it } from 'vitest';
import { RouteRequirements } from '../src/routes/routeObjectList';
import { NAVIGATION_ITEMS, NavRequirement } from '../src/definitions/NavigationItems';
import ROUTES from '../src/definitions/Routes';

describe('RouteRequirements', () => {
    it('guards exactly the routes the rail marks as needing a memory report', () => {
        const guarded = Object.entries(RouteRequirements)
            .filter(([, requirement]) => requirement.needsProfilerReport)
            .map(([route]) => route);

        expect(guarded.sort()).toEqual([ROUTES.OPERATIONS, ROUTES.TENSORS, ROUTES.BUFFERS, ROUTES.GRAPHTREE].sort());
    });

    it('guards exactly the routes the rail marks as needing a performance report', () => {
        const guarded = Object.entries(RouteRequirements)
            .filter(([, requirement]) => requirement.needsPerformanceReport)
            .map(([route]) => route);

        expect(guarded).toEqual([ROUTES.PERFORMANCE]);
    });

    // Cluster data and MLIR files are resolved in the client, so the instance-backed guard
    // has nothing to redirect on -- entering those routes directly must not bounce.
    it('leaves client-resolved requirements unguarded', () => {
        expect(RouteRequirements[ROUTES.CLUSTER]).toBeUndefined();
        expect(RouteRequirements[ROUTES.MLIR]).toBeUndefined();
    });

    it('leaves items with no requirement unguarded', () => {
        expect(RouteRequirements[ROUTES.HOME]).toBeUndefined();
        expect(RouteRequirements[ROUTES.NPE]).toBeUndefined();
    });

    // The guard matches on an exact pathname, so every key has to be a route a descriptor
    // actually names. A typo would disable the guard rather than fail anything.
    it('keys the table on routes the navigation descriptors declare', () => {
        const navRoutes = NAVIGATION_ITEMS.map((item) => item.route);

        Object.keys(RouteRequirements).forEach((route) => {
            expect(navRoutes).toContain(route);
        });
    });

    // Catches the derivation collapsing to an empty object, which every assertion above
    // that looks for absence would otherwise pass on.
    it('is not empty', () => {
        expect(Object.keys(RouteRequirements)).toHaveLength(
            NAVIGATION_ITEMS.filter(
                (item) =>
                    item.requirement === NavRequirement.PROFILER_REPORT ||
                    item.requirement === NavRequirement.PERFORMANCE_REPORT,
            ).length,
        );
    });
});
