// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { FocusStyleManager, OverlaysProvider } from '@blueprintjs/core';
import './index.scss';
import { HelmetProvider } from 'react-helmet-async';
import ErrorPage from './error-page';
import Layout from './components/Layout';
import Home from './routes/Home';
import Operations from './routes/Operations';
import OperationDetails from './routes/OperationDetails';
import Styleguide from './routes/Styleguide';
import ROUTES from './definitions/Routes';
import Tensors from './routes/Tensors';
import BufferSummary from './routes/BufferSummary';
import { SocketProvider } from './libs/SocketProvider';
import GraphView from './routes/GraphView';
import Performance from './routes/Performance';
import NPE from './routes/NPE';

const router = createBrowserRouter([
    {
        path: ROUTES.HOME,
        element: <Layout />,
        errorElement: <ErrorPage />,
        children: [
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
        ],
    },
]);

FocusStyleManager.onlyShowFocusOnTabs();

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Messes with Plotly event handling and we don't really need this anyway
            refetchOnWindowFocus: false,
        },
    },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
        <HelmetProvider>
            <React.StrictMode>
                <SocketProvider>
                    <OverlaysProvider>
                        <RouterProvider router={router} />
                    </OverlaysProvider>
                </SocketProvider>
            </React.StrictMode>
        </HelmetProvider>
    </QueryClientProvider>,
);
