import React from 'react';
import { FocusStyleManager } from '@blueprintjs/core';
import OperationList from './components/OperationList.tsx';
import TenstorrentLogo from './components/TenstorrentLogo';

function App() {
    FocusStyleManager.onlyShowFocusOnTabs();

    return (
        <>
            <header className='app-header'>
                <TenstorrentLogo />
            </header>
            <OperationList />;
        </>
    );
}

export default App;
