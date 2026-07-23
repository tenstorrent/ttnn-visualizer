// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import ROUTES from '../definitions/Routes';
import { RouteRequirements } from '../routes/routeObjectList';
import LoadingSpinner from './LoadingSpinner';
import 'styles/components/ProtectedRoute.scss';
import useRestoreInstance from '../hooks/useRestoreInstance';

interface ProtectedRouteProps {
    children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
    const { instance, hasRestoredInstance } = useRestoreInstance();
    const location = useLocation();

    const currentRoute = RouteRequirements[location.pathname];
    const needsProfiler = currentRoute?.needsProfilerReport ?? false;
    const needsPerformance = currentRoute?.needsPerformanceReport ?? false;

    // Wait until active-report atoms are hydrated from the instance. Previously
    // we only blocked while `useInstance` reported isLoading, so a settled
    // instance with an unfinished/failed folder-list fetch could leave the UI
    // in a half-restored state — or, after atom writes changed the instance
    // query key, isLoading&&!restored could stick with nothing in flight.
    if (!hasRestoredInstance) {
        return (
            <div className='instance-loader'>
                <LoadingSpinner />
                <p>Initializing instance...</p>
            </div>
        );
    }

    if (instance && !instance?.active_report?.profiler_name && needsProfiler) {
        // eslint-disable-next-line no-console
        console.info('No profiler report found, redirecting to home.', instance);

        return (
            <Navigate
                to={ROUTES.HOME}
                replace
            />
        );
    }

    if (instance && !instance?.active_report?.performance_name && needsPerformance) {
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
