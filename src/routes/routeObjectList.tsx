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
import ROUTES from '../definitions/Routes';
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
        path: stripFirstSlash(`${ROUTES.OPERATIONS}/:operationId`),
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
        path: stripFirstSlash(`${ROUTES.GRAPHTREE}/:operationId?`),
        element: <GraphView />,
    },
    {
        path: stripFirstSlash(ROUTES.PERFORMANCE),
        element: <Performance />,
    },
    {
        path: stripFirstSlash(`${ROUTES.NPE}/:filepath?`),
        element: <NPE />,
    },
    {
        path: stripFirstSlash(`${ROUTES.MLIR}/:filepath?`),
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

export const RouteRequirements: Record<string, RouteRequirements> = {
    [ROUTES.OPERATIONS]: {
        needsProfilerReport: true,
    },
    [ROUTES.TENSORS]: {
        needsProfilerReport: true,
    },
    [ROUTES.BUFFERS]: {
        needsProfilerReport: true,
    },
    [ROUTES.GRAPHTREE]: {
        needsProfilerReport: true,
    },
    [ROUTES.PERFORMANCE]: {
        needsPerformanceReport: true,
    },
};
