import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import './index.scss';
import OperationView from './roots/OperationView';
import OperationList from './components/OperationList';
import ErrorPage from './error-page';
import Layout from './components/Layout';
import Home from './roots/Home';

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
                element: <OperationList />,
            },
            {
                path: 'operations/:opId',
                loader: () => ({ message: "You're interested in viewing the following operation" }),
                element: <OperationView />,
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
