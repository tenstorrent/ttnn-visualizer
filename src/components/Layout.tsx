// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Outlet } from 'react-router-dom';
import { Classes, Icon, Tooltip } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtom } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import classNames from 'classnames';
import { IconNames } from '@blueprintjs/icons';
import { useEffect } from 'react';
import { activePerformanceTraceAtom, activeReportAtom } from '../store/app';
import MainNavigation from './MainNavigation';
import { useGetDeviceOperationListPerf, useSession } from '../hooks/useAPI';
import ROUTES from '../definitions/Routes';
import Range from './RangeSlider';

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

    const useGetDeviceOperationListPerfResult = useGetDeviceOperationListPerf();
    const isInSync = useGetDeviceOperationListPerfResult.length > 0;

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

            <footer className='app-footer'>
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
                            <span>
                                <strong>Report:</strong> {activeReport}
                            </span>
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
                            <span>
                                <strong>Performance:</strong> {activePerformanceTrace}
                            </span>
                        ))}
                    {activeReport && activePerformanceTrace && (
                        <span>
                            {isInSync ? (
                                <strong>
                                    <Icon
                                        icon={IconNames.TickCircle}
                                        className='intent-ok'
                                    />{' '}
                                    Profiler and perf reports synchronised
                                </strong>
                            ) : (
                                <strong>
                                    <Icon
                                        icon={IconNames.ISSUE}
                                        className='intent-not-ok'
                                    />{' '}
                                    Profiler and perf reports can&apos;t be synchronized
                                </strong>
                            )}
                        </span>
                    )}
                </div>

                <div className='slider'>
                    <Range />
                </div>
            </footer>
        </div>
    );
}

export default Layout;
