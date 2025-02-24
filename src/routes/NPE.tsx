import React from 'react';
import { Helmet } from 'react-helmet-async';

import NPEFileLoader from '../components/npe/NPEFileLoader';
import { NPEData } from '../model/NPEModel';
import NPEView from '../components/npe/NPEViewComponent';

const NPE: React.FC = () => {
    const [npeData, setNpeData] = React.useState<NPEData | null>(null);
    const onFileLoaded = (data: unknown) => {
        setNpeData(data as NPEData);
    };

    return (
        <>
            <Helmet title='NPE' />
            <NPEFileLoader onFileLoad={onFileLoaded} />
            {npeData && <NPEView npeData={npeData} />}
        </>
    );
};

export default NPE;
