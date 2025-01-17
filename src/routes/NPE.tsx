import React from 'react';
import { Helmet } from 'react-helmet-async';
import { npeTempData } from '../functions/npeTempData';
import NPEView from '../components/npe/NPE';

const NPE: React.FC = () => {
    return (
        <>
            <Helmet title='NPE' />
            <NPEView npeData={npeTempData} />
        </>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export default NPE;
