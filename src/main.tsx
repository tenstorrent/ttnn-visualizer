// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { FocusStyleManager, OverlaysProvider } from '@blueprintjs/core';
import './index.scss';
import { HelmetProvider } from 'react-helmet-async';
import { RouterProvider } from 'react-router';
import ErrorPage from './error-page';
import Layout from './components/Layout';
import ROUTES from './definitions/Routes';
import getServerConfig from './functions/getServerConfig';
import { SocketProvider } from './libs/SocketProvider';
import { routeObjectList } from './definitions/RouteObjectList';
import ProtectedRoute from './components/ProtectedRoute';

const router = createBrowserRouter(
    [
        {
            path: ROUTES.HOME,
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
const root = ReactDOM.createRoot(document.getElementById('root')!);
const AppTree = import.meta.env.DEV ? (
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <HelmetProvider>
                <SocketProvider>
                    <OverlaysProvider>
                        <RouterProvider router={router} />
                    </OverlaysProvider>
                </SocketProvider>
            </HelmetProvider>
        </QueryClientProvider>
    </React.StrictMode>
) : (
    <QueryClientProvider client={queryClient}>
        <HelmetProvider>
            <SocketProvider>
                <OverlaysProvider>
                    <RouterProvider router={router} />
                </OverlaysProvider>
            </SocketProvider>
        </HelmetProvider>
    </QueryClientProvider>
);
root.render(AppTree);
