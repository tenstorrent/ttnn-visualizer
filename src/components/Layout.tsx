import { Link, Outlet } from 'react-router-dom';
import { FocusStyleManager } from '@blueprintjs/core';
import TenstorrentLogo from './TenstorrentLogo';

function Layout() {
    FocusStyleManager.onlyShowFocusOnTabs();

    return (
        <>
            <header className='app-header'>
                <Link to='/'>
                    <TenstorrentLogo />
                </Link>
            </header>

            <main>
                <Outlet />
            </main>
        </>
    );
}

export default Layout;
