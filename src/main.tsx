// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FocusStyleManager, OverlaysProvider } from '@blueprintjs/core';
import './index.scss';
import { HelmetProvider } from 'react-helmet-async';
import { RouterProvider } from 'react-router';
import ErrorPage from './error-page';
import Layout from './components/Layout';
import getServerConfig from './functions/getServerConfig';
import { SocketProvider } from './libs/SocketProvider';
import { routeObjectList } from './definitions/RouteObjectList';
import ProtectedRoute from './components/ProtectedRoute';

const router = createBrowserRouter(
    [
        {
            path: '*',
            element: (
                <ProtectedRoute>
                    <Layout />
                </ProtectedRoute>
            ),
            errorElement: <ErrorPage />,
            children: routeObjectList,
        },
    ],
    {
        basename: getServerConfig().BASE_PATH,
    },
);

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
