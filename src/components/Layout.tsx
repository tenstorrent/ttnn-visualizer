// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Outlet } from 'react-router-dom';
import { Classes } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import { useEffect } from 'react';
import { activeNpeOpTraceAtom, activePerformanceReportAtom, activeProfilerReportAtom } from '../store/app';
import MainNavigation from './MainNavigation';
import { useSession } from '../hooks/useAPI';
import ROUTES from '../definitions/Routes';
import FooterInfobar from './FooterInfobar';

const BounceIn = cssTransition({
    enter: `Toastify--animate Toastify__bounce-enter`,
    exit: ` no-toast-animation Toastify__bounce-exit`,
    appendPosition: true,
    collapseDuration: 0,
    collapse: true,
});

function Layout() {
    const appVersion = import.meta.env.APP_VERSION;
    const setActiveProfilerReport = useSetAtom(activeProfilerReportAtom);
    const setActivePerformanceTrace = useSetAtom(activePerformanceReportAtom);
    const setActiveNpe = useSetAtom(activeNpeOpTraceAtom);
    const { data: session } = useSession();

    useEffect(() => {
        if (session?.active_report) {
            setActiveProfilerReport(session.active_report?.profiler_name ?? null);
            setActivePerformanceTrace(session.active_report?.performance_name ?? null);
            setActiveNpe(session.active_report?.npe_name ?? null);
        }
    }, [session, setActiveProfilerReport, setActivePerformanceTrace, setActiveNpe]);

    return (
        <div className={Classes.DARK}>
            <Helmet
                defaultTitle='TT-NN Visualizer'
                titleTemplate='%s | TT-NN Visualizer'
            >
                <meta charSet='utf-8' />
            </Helmet>

            <header className='app-header'>
                <nav className='nav-container'>
                    <a
                        href={ROUTES.HOME}
                        className='title'
                    >
                        <h1>TT-NN Visualizer</h1>
                        <sup className='version'>v{appVersion}</sup>
                    </a>
                    <MainNavigation />
                </nav>
            </header>

            <main>
                <Outlet />

                <ToastContainer
                    position='top-right'
                    autoClose={false}
                    newestOnTop={false}
                    closeOnClick
                    closeButton={false}
                    theme='light'
                    transition={BounceIn}
                />
            </main>

            <FooterInfobar />
        </div>
    );
}

export default Layout;
