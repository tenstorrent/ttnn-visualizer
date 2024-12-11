// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Link, Outlet } from 'react-router-dom';
import { Classes, Tooltip } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import TenstorrentLogo from './TenstorrentLogo';
import ROUTES from '../definitions/routes';
import { reportMetaAtom } from '../store/app';
import MainNavigation from './MainNavigation';
import { useSession } from '../hooks/useAPI';

const BounceIn = cssTransition({
    enter: `Toastify--animate Toastify__bounce-enter`,
    exit: ` no-toast-animation Toastify__bounce-exit`,
    appendPosition: true,
    collapseDuration: 0,
    collapse: true,
});

function Layout() {
    const appVersion = import.meta.env.APP_VERSION;
    const meta = useAtomValue(reportMetaAtom);
    const { data: tabSession } = useSession();

    return (
        <div className={Classes.DARK}>
            <Helmet
                defaultTitle='TTNN Visualizer'
                titleTemplate='%s | TTNN Visualizer'
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

                    <div className='current-data'>
                        {meta?.report_name && (
                            <Tooltip
                                content={meta.report_name}
                                className='report-title'
                            >
                                <span>{meta.report_name}</span>
                            </Tooltip>
                        )}

                        {tabSession?.active_report?.profile_name && (
                            <Tooltip
                                content={tabSession?.active_report?.profile_name}
                                className='report-title'
                            >
                                <span>{tabSession?.active_report?.profile_name}</span>
                            </Tooltip>
                        )}
                    </div>

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
        </div>
    );
}

export default Layout;
