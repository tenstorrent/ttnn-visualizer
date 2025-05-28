// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import Home from '../routes/Home';
import Operations from '../routes/Operations';
import OperationDetails from '../routes/OperationDetails';
import Tensors from '../routes/Tensors';
import BufferSummary from '../routes/BufferSummary';
import Styleguide from '../routes/Styleguide';
import GraphView from '../routes/GraphView';
import Performance from '../routes/Performance';
import NPE from '../routes/NPE';
import ROUTES from './Routes';

export const routeObjectList = [
    {
        index: true,
        element: <Home />,
    },
    {
        path: ROUTES.OPERATIONS,
        element: <Operations />,
    },
    {
        path: `${ROUTES.OPERATIONS}/:operationId`,
        element: <OperationDetails />,
    },
    {
        path: ROUTES.TENSORS,
        element: <Tensors />,
    },
    {
        path: ROUTES.BUFFERS,
        element: <BufferSummary />,
    },
    {
        path: ROUTES.STYLEGUIDE,
        element: <Styleguide />,
    },
    {
        path: `${ROUTES.GRAPHTREE}/:operationId?`,
        element: <GraphView />,
    },
    {
        path: ROUTES.PERFORMANCE,
        element: <Performance />,
    },
    {
        path: ROUTES.NPE,
        element: <NPE />,
    },
    {
        path: ROUTES.CLUSTER,
        element: null,
    },
];
