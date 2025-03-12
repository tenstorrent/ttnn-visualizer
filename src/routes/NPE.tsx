import React from 'react';
import { Helmet } from 'react-helmet-async';

import { useAtomValue } from 'jotai';
import NPEFileLoader from '../components/npe/NPEFileLoader';
import NPEView from '../components/npe/NPEViewComponent';
import { useNpe } from '../hooks/useAPI';
import { activeNpeAtom } from '../store/app';

const NPE: React.FC = () => {
    const npeFileName = useAtomValue(activeNpeAtom);
    const { data: npeData } = useNpe(npeFileName);

    return (
        <>
            <Helmet title='NPE' />

            <NPEFileLoader />

            {npeData && <NPEView npeData={npeData} />}
        </>
    );
};

export default NPE;
