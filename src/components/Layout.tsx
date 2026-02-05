// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Link, useLocation } from 'react-router-dom';
import { Classes } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { Theme, ToastContainer, ToastPosition, cssTransition } from 'react-toastify';
import 'styles/components/ToastOverrides.scss';

import MainNavigation from './MainNavigation';
import ROUTES from '../definitions/Routes';
import FooterInfobar from './FooterInfobar';
import ClusterRenderer from './cluster/ClusterRenderer';
import { ModalAwareOutlet } from '../libs/ModalAwareOutlet';
import FeedbackButton from './FeedbackButton';

const BounceIn = cssTransition({
    enter: `Toastify--animate Toastify__bounce-enter`,
    exit: ` no-toast-animation Toastify__bounce-exit`,
    appendPosition: true,
    collapseDuration: 0,
    collapse: true,
});

function Layout() {
    const location = useLocation();
    const appVersion = import.meta.env.APP_VERSION;
    const state = location.state as { background?: Location };

    return (
        <div className={Classes.DARK}>
            <Helmet
                defaultTitle='TT-NN Visualizer'
                titleTemplate='%s | TT-NN Visualizer'
            >
                <meta charSet='utf-8' />
                <meta
                    name='description'
                    content='A comprehensive tool for visualizing and analyzing model execution, offering interactive graphs, memory plots, tensor details, buffer overviews, operation flow graphs, and multi-instance support with file or SSH-based report loading.'
                />
            </Helmet>

            <header className='app-header'>
                <nav className='nav-container'>
                    <Link
                        to={ROUTES.HOME}
                        className='title'
                    >
                        <h1>
                            <img
                                width={250}
                                alt='tenstorrent'
                                src='https://docs.tenstorrent.com/tt-tm-assets/Logo/Standard%20Lockup/svg/tt_logo_color-orange-whitetext.svg'
                            />
                            <span className='visualizer-title'>TT-NN Visualizer</span>
                        </h1>
                        <sup className='version'>v{appVersion}</sup>
                    </Link>

                    <MainNavigation />
                </nav>
            </header>

            <main>
                <ModalAwareOutlet />
                {location.pathname === ROUTES.CLUSTER && state?.background && <ClusterRenderer />}
            </main>

            <FooterInfobar />

            <FeedbackButton />

            <ToastContainer
                position={'bottom-right' as ToastPosition}
                autoClose={5000}
                newestOnTop={false}
                pauseOnHover={false}
                draggable={false}
                closeOnClick
                closeButton={false}
                theme={'light' as Theme}
                transition={BounceIn}
            />
        </div>
    );
}

export default Layout;
