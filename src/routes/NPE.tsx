import React from 'react';
import { Helmet } from 'react-helmet-async';

import { useAtomValue } from 'jotai';
import NPEFileLoader from '../components/npe/NPEFileLoader';
import NPEView from '../components/npe/NPEViewComponent';
import { useNpe } from '../hooks/useAPI';
import { activeNpeOpTraceAtom } from '../store/app';
import { NPEData } from '../model/NPEModel';

const NPE: React.FC = () => {
    const npeFileName = useAtomValue(activeNpeOpTraceAtom);
    const { data: npeData } = useNpe(npeFileName);

    return (
        <>
            <Helmet title='NPE' />

            <h1 className='page-title'>NOC performance estimator</h1>

            <NPEFileLoader />

            {/* eslint-disable-next-line no-nested-ternary */}
            {npeData ? (
                isValidNpeData(npeData) ? (
                    <NPEView npeData={npeData} />
                ) : (
                    'Invalid NPE data'
                )
            ) : (
                <>
                    <p>Please upload a NPE file for analysis.</p>
                    <p>
                        See <a href='https://github.com/tenstorrent/tt-npe'>tt-npe</a> for details on how to generate
                        NPE files.
                    </p>
                </>
            )}
        </>
    );
};

// This should be done server side
const isValidNpeData = (data: NPEData): boolean => {
    const requiredKeys: (keyof NPEData)[] = ['common_info', 'noc_transfers', 'timestep_data'];
    const hasAllKeys = requiredKeys.every((key) => key in data);

    if (!hasAllKeys) {
        return false;
    }

    return true;
};

export default NPE;
