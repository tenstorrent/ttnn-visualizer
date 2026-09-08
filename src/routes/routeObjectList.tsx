// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import Home from './Home';
import Operations from './Operations';
import OperationDetails from './OperationDetails';
import Tensors from './Tensors';
import BufferSummary from './BufferSummary';
import Styleguide from './Styleguide';
import GraphView from './GraphView';
import Performance from './Performance';
import NPE from './NPE';
import ROUTES, { ROUTE_PATTERNS } from '../definitions/Routes';
import { NAVIGATION_ITEMS, NavRequirement } from '../definitions/NavigationItems';
import MLIR from './MLIR';

// Allows us to keep absolute paths in ROUTES while using relative paths in route objects
const stripFirstSlash = (path: string) => {
    return path.startsWith('/') ? path.slice(1) : path;
};

export const routeObjectList = [
    {
        index: true,
        element: <Home />,
    },
    {
        path: stripFirstSlash(ROUTES.OPERATIONS),
        element: <Operations />,
    },
    {
        path: stripFirstSlash(ROUTE_PATTERNS.OPERATION_DETAILS),
        element: <OperationDetails />,
    },
    {
        path: stripFirstSlash(ROUTES.TENSORS),
        element: <Tensors />,
    },
    {
        path: stripFirstSlash(ROUTES.BUFFERS),
        element: <BufferSummary />,
    },
    {
        path: stripFirstSlash(ROUTES.STYLEGUIDE),
        element: <Styleguide />,
    },
    {
        path: stripFirstSlash(ROUTE_PATTERNS.GRAPHTREE),
        element: <GraphView />,
    },
    {
        path: stripFirstSlash(ROUTES.PERFORMANCE),
        element: <Performance />,
    },
    {
        path: stripFirstSlash(ROUTE_PATTERNS.NPE),
        element: <NPE />,
    },
    {
        path: stripFirstSlash(ROUTE_PATTERNS.MLIR),
        element: <MLIR />,
    },
    {
        path: stripFirstSlash(ROUTES.CLUSTER),
        element: null,
    },
];

interface RouteRequirements {
    needsProfilerReport?: boolean;
    needsPerformanceReport?: boolean;
}

// The instance-backed half of a navigation requirement. Only the two report requirements
// have one: cluster data and MLIR files are resolved in the client, so there is nothing
// here for the route guard to redirect on.
const INSTANCE_GUARD_BY_REQUIREMENT: Partial<Record<NavRequirement, RouteRequirements>> = {
    [NavRequirement.PROFILER_REPORT]: { needsProfilerReport: true },
    [NavRequirement.PERFORMANCE_REPORT]: { needsPerformanceReport: true },
};

// Derived from the navigation descriptors so "which report does this route need" is stated
// once. Hand-maintaining a second copy drifts silently in both directions: an item the rail
// offers that this guard bounces back to Home, or one greyed out for a reachable route.
export const RouteRequirements: Record<string, RouteRequirements> = Object.fromEntries(
    NAVIGATION_ITEMS.map((item) => [item.route, INSTANCE_GUARD_BY_REQUIREMENT[item.requirement]] as const).filter(
        (entry): entry is [string, RouteRequirements] => entry[1] !== undefined,
    ),
);
