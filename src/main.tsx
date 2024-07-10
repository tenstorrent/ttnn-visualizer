import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { FocusStyleManager } from '@blueprintjs/core';
import './index.scss';
import { HelmetProvider } from 'react-helmet-async';
import ErrorPage from './error-page';
import Layout from './components/Layout';
import Home from './routes/Home';
import Operations from './routes/Operations';
import OperationDetails from './routes/OperationDetails';
import ROUTES from './definitions/routes';

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
        ],
    },
]);

FocusStyleManager.onlyShowFocusOnTabs();

const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
        <HelmetProvider>
            <React.StrictMode>
                <RouterProvider router={router} />
            </React.StrictMode>
        </HelmetProvider>
    </QueryClientProvider>,
);
