// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import ROUTES from '../definitions/Routes';
import { useSession } from '../hooks/useAPI';
import { RouteRequirements } from '../definitions/RouteObjectList';
import LoadingSpinner from './LoadingSpinner';
import 'styles/components/ProtectedRoute.scss';

interface ProtectedRouteProps {
    children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
    const { data: session, isLoading } = useSession();
    const location = useLocation();

    const currentRoute = RouteRequirements[location.pathname];
    const needsProfiler = currentRoute?.needsProfilerReport ?? false;
    const needsPerformance = currentRoute?.needsPerformanceReport ?? false;

    if (isLoading || session === undefined) {
        return (
            <div className='session-loader'>
                <LoadingSpinner />
                <p>Currently fetching session...</p>
            </div>
        );
    }

    if (session && !session?.active_report?.profiler_name && needsProfiler) {
        // eslint-disable-next-line no-console
        console.info('No profiler report found, redirecting to home.', session);

        return (
            <Navigate
                to={ROUTES.HOME}
                replace
            />
        );
    }

    if (session && !session?.active_report?.performance_name && needsPerformance) {
        // eslint-disable-next-line no-console
        console.info('No performance report found, redirecting to home.');

        return (
            <Navigate
                to={ROUTES.HOME}
                replace
            />
        );
    }

    return children;
};

export default ProtectedRoute;
