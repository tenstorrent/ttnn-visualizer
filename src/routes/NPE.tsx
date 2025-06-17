// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/* eslint-disable no-nested-ternary */
// Temporary solution for now
import React from 'react';
import { Helmet } from 'react-helmet-async';

import { useAtomValue } from 'jotai';
import NPEFileLoader from '../components/npe/NPEFileLoader';
import NPEView from '../components/npe/NPEViewComponent';
import { useNpe } from '../hooks/useAPI';
import { activeNpeOpTraceAtom } from '../store/app';
import { NPEData } from '../model/NPEModel';
import LoadingSpinner from '../components/LoadingSpinner';
import { semverParse } from '../functions/semverParse';

const NPE_DATA_VERSION = '1.0.0';

const NPE_REPO_URL = (
    <a
        target='_blank'
        href='https://github.com/tenstorrent/tt-npe'
        rel='noreferrer'
    >
        tt-npe
    </a>
);

const NPE: React.FC = () => {
    const npeFileName = useAtomValue(activeNpeOpTraceAtom);
    const { data: npeData, isLoading } = useNpe(npeFileName);

    return (
        <>
            <Helmet title='NPE' />

            <h1 className='page-title'>NOC performance estimator</h1>

            <NPEFileLoader />

            {isLoading ? (
                <LoadingSpinner />
            ) : npeData ? (
                isValidNpeData(npeData) ? (
                    <NPEView npeData={npeData} />
                ) : (
                    <>
                        <p>
                            Invalid NPE data or version. Current supported version is {NPE_DATA_VERSION} got&nbsp;
                            {npeData.common_info.version || 'null'};
                        </p>
                        <p>
                            Use {NPE_REPO_URL} to generate new NPE dataset
                            {matchNpeDataVersion(npeData.common_info.version) ? (
                                <>
                                    {' '}
                                    or install an older version of the visualizer{' '}
                                    <pre>
                                        pip install ttnn-visualizer=={matchNpeDataVersion(npeData.common_info.version)}
                                    </pre>
                                </>
                            ) : null}
                        </p>
                    </>
                )
            ) : (
                <>
                    <p>Please upload a NPE file for analysis.</p>
                    <p>See {NPE_REPO_URL} for details on how to generate NPE files.</p>
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
    const version = semverParse(data.common_info.version);
    if (!version) {
        return false;
    }
    const expectedVersion = semverParse(NPE_DATA_VERSION);

    if (version?.major !== expectedVersion?.major) {
        return false;
    }

    return true;
};

const matchNpeDataVersion = (version: string) => {
    const parsedVersion = semverParse(version);
    switch (parsedVersion) {
        case null:
        case undefined:
            return '0.32.3';
        default:
            return '';
    }
};

export default NPE;
