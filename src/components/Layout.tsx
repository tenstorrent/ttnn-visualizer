// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Outlet } from 'react-router-dom';
import { Classes, Tooltip } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtom } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import classNames from 'classnames';
import { useEffect } from 'react';
import { activePerformanceTraceAtom, activeReportAtom } from '../store/app';
import MainNavigation from './MainNavigation';
import { useSession } from '../hooks/useAPI';

const BounceIn = cssTransition({
    enter: `Toastify--animate Toastify__bounce-enter`,
    exit: ` no-toast-animation Toastify__bounce-exit`,
    appendPosition: true,
    collapseDuration: 0,
    collapse: true,
});

const MAX_TITLE_LENGTH = 20;

function Layout() {
    const appVersion = import.meta.env.APP_VERSION;
    const [activeReport, setActiveReport] = useAtom(activeReportAtom);
    const [activePerformanceTrace, setActivePerformanceTrace] = useAtom(activePerformanceTraceAtom);
    const { data: session } = useSession(activeReport, activePerformanceTrace);

    useEffect(() => {
        if (session?.active_report) {
            setActiveReport(session.active_report?.report_name ?? null);
            setActivePerformanceTrace(session.active_report?.profile_name ?? null);
        }
    }, [session, setActiveReport, setActivePerformanceTrace]);

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
                    <div className='title'>
                        <h1>TT-NN Visualizer</h1>
                        <sup className='version'>v{appVersion}</sup>
                    </div>
                    <MainNavigation />
                </nav>

                <div className='current-data'>
                    {activeReport &&
                        (activeReport.length > MAX_TITLE_LENGTH ? (
                            <Tooltip
                                content={activeReport}
                                className={classNames('title', {
                                    'is-lengthy': activeReport.length > MAX_TITLE_LENGTH,
                                })}
                            >
                                <span>
                                    <strong>Report:</strong> {activeReport}
                                </span>
                            </Tooltip>
                        ) : (
                            <>
                                <strong>Report:</strong> {activeReport}
                            </>
                        ))}

                    {activePerformanceTrace &&
                        (activePerformanceTrace.length > MAX_TITLE_LENGTH ? (
                            <Tooltip
                                content={activePerformanceTrace}
                                className={classNames('title', {
                                    'is-lengthy': activePerformanceTrace.length > MAX_TITLE_LENGTH,
                                })}
                            >
                                <span>
                                    <strong>Performance:</strong> {activePerformanceTrace}
                                </span>
                            </Tooltip>
                        ) : (
                            <>
                                <strong>Performance:</strong> {activePerformanceTrace}
                            </>
                        ))}
                </div>
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
        </div>
    );
}

export default Layout;
