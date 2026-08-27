// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { Theme, ToastContainer, ToastPosition, cssTransition } from 'react-toastify';
import 'styles/components/ToastOverrides.scss';

import SideNavigation from './SideNavigation';
import ServerModeBanner from './ServerModeBanner';
import ROUTES from '../definitions/Routes';
import FooterInfobar from './FooterInfobar';
import ClusterRenderer from './cluster/ClusterRenderer';
import { ModalAwareOutlet } from '../libs/ModalAwareOutlet';
import FeedbackButton from './FeedbackButton';
import FileStatusOverlay from './FileStatusOverlay';
import MlirFileResultsOverlay from './mlir/MlirFileResultsOverlay';
import { initUsageRecording } from '../functions/recordUsage';

const BounceIn = cssTransition({
    enter: `Toastify--animate Toastify__bounce-enter`,
    exit: ` no-toast-animation Toastify__bounce-exit`,
    appendPosition: true,
    collapseDuration: 0,
    collapse: true,
});

function Layout() {
    const location = useLocation();
    const state = location.state as { background?: Location };

    // Starts the usage flush lifecycle; it records nothing on its own. Here rather than at
    // module scope so importing the sender has no side effect, and so the listeners are
    // owned the way every other listener in this app is.
    useEffect(() => initUsageRecording(), []);

    return (
        <>
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

            <ServerModeBanner />

            {/* Wraps only the chrome that shares space with the page: the fixed footer and
                the overlays below must stay outside so the flex shell can't reposition them. */}
            <div className='app-shell'>
                <SideNavigation />

                <main>
                    <ModalAwareOutlet />
                    {location.pathname === ROUTES.CLUSTER && state?.background && <ClusterRenderer />}
                </main>
            </div>

            <FooterInfobar />

            <FeedbackButton />

            <FileStatusOverlay />

            <MlirFileResultsOverlay />

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
        </>
    );
}

export default Layout;
