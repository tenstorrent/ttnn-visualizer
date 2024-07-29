import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Classes } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Helmet } from 'react-helmet-async';
import TenstorrentLogo from './TenstorrentLogo';
import { useReportMeta } from '../hooks/useAPI';
import ROUTES from '../definitions/routes';

function Layout() {
    const navigate = useNavigate();
    const location = useLocation();
    const { data: report } = useReportMeta();

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

                {/* TODO: Handle navigation variations differently */}
                {location.pathname !== ROUTES.HOME && (
                    <>
                        <span className='report-title'>{report?.report_name}</span>

                        <nav>
                            <Button
                                minimal
                                icon={IconNames.FOLDER_SHARED_OPEN}
                                onClick={() => handleNavigate(ROUTES.HOME)}
                            >
                                Select report
                            </Button>
                        </nav>
                    </>
                )}
            </header>

            <main>
                <Outlet />
            </main>
        </div>
    );
}

export default Layout;
