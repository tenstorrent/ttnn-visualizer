// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Alignment, Button, Classes, Navbar, Tooltip } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { useQuery } from 'react-query';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import TenstorrentLogo from './TenstorrentLogo';
import ROUTES from '../definitions/routes';
import { reportMetaAtom } from '../store/app';
import { fetchActiveReport } from '../hooks/useAPI';

const BounceIn = cssTransition({
    enter: `Toastify--animate Toastify__bounce-enter`,
    exit: ` no-toast-animation Toastify__bounce-exit`,
    appendPosition: true,
    collapseDuration: 0,
    collapse: true,
});

function Layout() {
    const appVersion = import.meta.env.APP_VERSION; // Access the version from Vite
    const navigate = useNavigate();
    const meta = useAtomValue(reportMetaAtom);
    const { data: activeReport } = useQuery('active_report', {
        queryFn: fetchActiveReport,
        initialData: null,
    });

    const handleNavigate = (path: string) => {
        navigate(path);
    };

    return (
        <div className={Classes.DARK}>
            <Helmet
                defaultTitle='TTNN Visualizer'
                titleTemplate='%s | TTNN Visualizer'
            >
                <meta charSet='utf-8' />
            </Helmet>

            <header className='app-header'>
                <nav className="nav-container">
                    <Link
                        className="tt-logo"
                        to={ROUTES.HOME}
                    >
                        <TenstorrentLogo />
                    </Link>
                    <p>{appVersion}</p>

                    <Navbar>
                        <>
                            <Navbar.Group align={Alignment.RIGHT}>
                                <Button
                                    text='Home'
                                    onClick={() => handleNavigate(ROUTES.HOME)}
                                    active={window.location.pathname === ROUTES.HOME}
                                    minimal
                                />

                                <Button
                                    text='Operations'
                                    disabled={!activeReport?.name}
                                    onClick={() => handleNavigate(ROUTES.OPERATIONS)}
                                    active={window.location.pathname === ROUTES.OPERATIONS}
                                    minimal
                                />

                                <Button
                                    text='Tensors'
                                    disabled={!activeReport?.name}
                                    onClick={() => handleNavigate(ROUTES.TENSORS)}
                                    active={window.location.pathname === ROUTES.TENSORS}
                                    minimal
                                />
                            </Navbar.Group>

                            {meta?.report_name && (
                                <Tooltip
                                    content={meta.report_name}
                                    className='report-title'
                                >
                                    <span>{meta.report_name}</span>
                                </Tooltip>
                            )}
                        </>
                    </Navbar>
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
