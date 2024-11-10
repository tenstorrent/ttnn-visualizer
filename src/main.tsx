// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FocusStyleManager, OverlaysProvider } from '@blueprintjs/core';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from 'react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import Layout from './components/Layout';
import ROUTES from './definitions/routes';
import ErrorPage from './error-page';
import './index.scss';
import { SocketProvider } from './libs/SocketProvider';
import BufferSummary from './routes/BufferSummary';
import GraphView from './routes/GraphView';
import Home from './routes/Home';
import OperationDetails from './routes/OperationDetails';
import Operations from './routes/Operations';
import Styleguide from './routes/Styleguide';
import Tensors from './routes/Tensors';

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
                path: 'operations',
                element: <Operations />,
            },
            {
                path: 'operations/:operationId',
                element: <OperationDetails />,
            },
            {
                path: 'tensors',
                element: <Tensors />,
            },
            {
                path: 'buffer-summary',
                element: <BufferSummary />,
            },
            {
                path: 'styleguide',
                element: <Styleguide />,
            },
            {
                path: 'graphtree/:operationId?',
                element: <GraphView />,
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
    <SocketProvider>

        <QueryClientProvider client={queryClient}>
            <HelmetProvider>
                <React.StrictMode>
                    <OverlaysProvider>
                        <RouterProvider router={router} />
                    </OverlaysProvider>
                </React.StrictMode>
            </HelmetProvider>
        </QueryClientProvider>,
    </SocketProvider>
);
