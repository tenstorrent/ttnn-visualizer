// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Link, Outlet } from 'react-router-dom';
import { Classes, Tooltip } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import classNames from 'classnames';
import TenstorrentLogo from './TenstorrentLogo';
import ROUTES from '../definitions/routes';
import { activePerformanceTraceAtom, activeReportAtom } from '../store/app';
import MainNavigation from './MainNavigation';

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
    const activeReport = useAtomValue(activeReportAtom);
    const activePerformanceTrace = useAtomValue(activePerformanceTraceAtom);

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
                    <Link
                        className='tt-logo'
                        to={ROUTES.HOME}
                    >
                        <TenstorrentLogo />
                        <p className='version'>v{appVersion}</p>
                    </Link>
                    <MainNavigation />
                </nav>

                <div className='current-data'>
                    {activeReport && (
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
                    )}

                    {activePerformanceTrace && (
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
                    )}
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
