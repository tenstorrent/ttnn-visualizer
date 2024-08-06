import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Button, Classes, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import TenstorrentLogo from './TenstorrentLogo';
import ROUTES from '../definitions/routes';
import { reportMetaAtom } from '../store/app';

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
                <Link to={ROUTES.HOME}>
                    <TenstorrentLogo />
                </Link>

                {meta?.report_name && (
                    <Tooltip
                        content={meta.report_name}
                        className='report-title'
                    >
                        <span className='report-title'>{meta.report_name}</span>
                    </Tooltip>
                )}

                <nav>
                    <Button
                        minimal
                        icon={IconNames.FOLDER_SHARED_OPEN}
                        onClick={() => handleNavigate(ROUTES.HOME)}
                    >
                        Select report
                    </Button>
                </nav>
            </header>

            <main>
                <Outlet />
            </main>
        </div>
    );
}

export default Layout;
