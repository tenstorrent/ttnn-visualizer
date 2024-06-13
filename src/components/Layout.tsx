import { Outlet } from 'react-router-dom';
import { FocusStyleManager } from '@blueprintjs/core';
import TenstorrentLogo from './TenstorrentLogo';

function Layout() {
    FocusStyleManager.onlyShowFocusOnTabs();

    return (
        <>
            <header className='app-header'>
                <TenstorrentLogo />
            </header>
            <main>
                <Outlet />
            </main>
        </>
    );
}

export default Layout;
