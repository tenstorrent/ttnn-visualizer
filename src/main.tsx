import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import './index.scss';
import ErrorPage from './error-page';
import Layout from './components/Layout';
import Home from './roots/Home';
import Operations from './roots/Operations';
import OperationDetails from './roots/OperationDetails';

const router = createBrowserRouter([
    {
        path: '/',
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
                loader: () => ({ message: "You're interested in viewing the following operation" }),
                element: <OperationDetails />,
            },
        ],
    },
]);

const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
        <React.StrictMode>
            <RouterProvider router={router} />
        </React.StrictMode>
    </QueryClientProvider>,
);
