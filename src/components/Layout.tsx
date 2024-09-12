import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Alignment, Button, Classes, Intent, Navbar, Tooltip } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
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

                    <Navbar>
                        <>
                            <Navbar.Group align={Alignment.RIGHT}>
                                <Button
                                    text='Home'
                                    onClick={() => handleNavigate(ROUTES.HOME)}
                                    active={window.location.pathname === ROUTES.HOME}
                                    intent={window.location.pathname === ROUTES.HOME ? Intent.PRIMARY : Intent.NONE}
                                    minimal
                                />

                                <Button
                                    text='Operations'
                                    onClick={() => handleNavigate(ROUTES.OPERATIONS)}
                                    active={window.location.pathname === ROUTES.OPERATIONS}
                                    intent={
                                        window.location.pathname === ROUTES.OPERATIONS ? Intent.PRIMARY : Intent.NONE
                                    }
                                    minimal
                                />

                                <Button
                                    text='Tensors'
                                    onClick={() => handleNavigate(ROUTES.TENSORS)}
                                    active={window.location.pathname === ROUTES.TENSORS}
                                    intent={window.location.pathname === ROUTES.TENSORS ? Intent.PRIMARY : Intent.NONE}
                                    minimal
                                />

                                <Button
                                    text='Styleguide'
                                    onClick={() => handleNavigate(ROUTES.STYLEGUIDE)}
                                    active={window.location.pathname === ROUTES.STYLEGUIDE}
                                    intent={
                                        window.location.pathname === ROUTES.STYLEGUIDE ? Intent.PRIMARY : Intent.NONE
                                    }
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
