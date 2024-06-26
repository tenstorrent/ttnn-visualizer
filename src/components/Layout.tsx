import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import TenstorrentLogo from './TenstorrentLogo';
import { useReport } from '../hooks/useAPI';

function Layout() {
    const navigate = useNavigate();
    const location = useLocation();
    const report = useReport();

    const handleNavigate = (path: string) => {
        navigate(path);
    };

    return (
        <div className='bp5-dark'>
            <header className='app-header'>
                <Link to='/'>
                    <TenstorrentLogo />
                </Link>

                {/* TODO: Handle navigation variations differently */}
                {location.pathname !== '/' && (
                    <>
                        <span className='report-title'>{report.report_name}</span>

                        <nav>
                            <Button minimal icon={IconNames.FOLDER_SHARED_OPEN} onClick={() => handleNavigate('/')}>
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
