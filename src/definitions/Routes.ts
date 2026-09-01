// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

const ROUTES = Object.freeze({
    HOME: '/',
    OPERATIONS: '/operations',
    TENSORS: '/tensors',
    BUFFERS: '/buffer-summary',
    STYLEGUIDE: '/styleguide',
    GRAPHTREE: '/graphtree',
    PERFORMANCE: '/performance',
    NPE: '/npe',
    MLIR: '/mlir',
    CLUSTER: '/cluster',
});

// Parameterised shapes are shared by React Router and usage-view matching. Keeping them
// here means changing a route cannot silently leave instrumentation matching its old URL.
export const ROUTE_PATTERNS = Object.freeze({
    OPERATION_DETAILS: `${ROUTES.OPERATIONS}/:operationId`,
    GRAPHTREE: `${ROUTES.GRAPHTREE}/:operationId?`,
    NPE: `${ROUTES.NPE}/:filepath?`,
    MLIR: `${ROUTES.MLIR}/:filepath?`,
});

export default ROUTES;
