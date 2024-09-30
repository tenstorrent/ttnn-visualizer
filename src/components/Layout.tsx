import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Alignment, Button, Classes, Intent, Navbar, Tooltip } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import { IconNames } from '@blueprintjs/icons';
import TenstorrentLogo from './TenstorrentLogo';
import ROUTES from '../definitions/routes';
import { reportMetaAtom } from '../store/app';

const BounceIn = cssTransition({
    enter: `Toastify--animate Toastify__bounce-enter`,
    exit: ` no-toast-animation Toastify__bounce-exit`,
    appendPosition: true,
    collapseDuration: 0,
    collapse: true,
});

function Layout() {
    const navigate = useNavigate();
    const meta = useAtomValue(reportMetaAtom);

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
                <nav className='nav-container'>
                    <Link
                        className='tt-logo'
                        to={ROUTES.HOME}
                    >
                        <TenstorrentLogo />
                    </Link>

                    {meta?.report_name && (
                        <Tooltip
                            content={meta.report_name}
                            className='report-title'
                        >
                            <span>{meta.report_name}</span>
                        </Tooltip>
                    )}

                    <Navbar className='navbar'>
                        <Navbar.Group align={Alignment.RIGHT}>
                            <Button
                                text='Home'
                                onClick={() => handleNavigate(ROUTES.HOME)}
                                active={hasMatchingPath(ROUTES.HOME)}
                                intent={hasMatchingPath(ROUTES.HOME) ? Intent.PRIMARY : Intent.SUCCESS}
                                icon={IconNames.HOME}
                                minimal
                                large
                            />

                            <Button
                                text='Operations'
                                onClick={() => handleNavigate(ROUTES.OPERATIONS)}
                                active={hasMatchingPath(ROUTES.OPERATIONS)}
                                intent={hasMatchingPath(ROUTES.OPERATIONS) ? Intent.PRIMARY : Intent.WARNING}
                                icon={IconNames.CUBE}
                                minimal
                                large
                            />

                            <Button
                                text='Tensors'
                                onClick={() => handleNavigate(ROUTES.TENSORS)}
                                active={hasMatchingPath(ROUTES.TENSORS)}
                                intent={hasMatchingPath(ROUTES.TENSORS) ? Intent.PRIMARY : Intent.DANGER}
                                icon={IconNames.FLOW_LINEAR}
                                minimal
                                large
                            />
                        </Navbar.Group>
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

function hasMatchingPath(path: string) {
    return window.location.pathname === path;
}

export default Layout;
