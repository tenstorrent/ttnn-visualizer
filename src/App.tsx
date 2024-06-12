import React, { useEffect, useState } from 'react';
import { FocusStyleManager } from '@blueprintjs/core';
import axios from 'axios';
import OperationList from './components/OperationList.tsx';
import TenstorrentLogo from './components/TenstorrentLogo';

function App() {
    FocusStyleManager.onlyShowFocusOnTabs();

    const [message, setMessage] = useState('');

    useEffect(() => {
        axios
            .get('http://localhost:8000/api')
            .then((response) => {
                setMessage(response.data.message);
            })
            .catch((error) => {
                console.error('There was an error!', error);
            });
    }, []);

    return (
        <>
            {message && <h1>{message}</h1>}
            <header className='app-header'>
                <TenstorrentLogo />
            </header>
            <OperationList />;
        </>
    );
}

export default App;
