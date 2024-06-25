import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, FocusStyleManager } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import TenstorrentLogo from './TenstorrentLogo';

function Layout() {
    FocusStyleManager.onlyShowFocusOnTabs();
    const navigate = useNavigate();
    const navigation = useLocation();

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
                {navigation.pathname !== '/' && (
                    <nav>
                        <Button minimal icon={IconNames.FOLDER_SHARED_OPEN} onClick={() => handleNavigate('/')}>
                            Select new report
                        </Button>
                    </nav>
                )}
            </header>

            <main>
                <Outlet />
            </main>
        </div>
    );
}

export default Layout;
