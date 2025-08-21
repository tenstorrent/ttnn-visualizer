// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { Callout } from '@blueprintjs/core';
import { useParams } from 'react-router';
import NPEFileLoader from '../components/npe/NPEFileLoader';
import NPEView from '../components/npe/NPEViewComponent';
import { useNPETimelineFile, useNpe } from '../hooks/useAPI';
import { activeNpeOpTraceAtom } from '../store/app';
import { NPEData } from '../model/NPEModel';
import LoadingSpinner from '../components/LoadingSpinner';
import { semverParse } from '../functions/semverParse';
import getServerConfig from '../functions/getServerConfig';
import NPEProcessingStatus from '../components/NPEProcessingStatus';
import 'styles/routes/NPE.scss';
import NPEDemoSelect, { NPEDemoData } from '../components/npe/NPEDemoSelect';

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

const NPE: FC = () => {
    const { filepath } = useParams<{ filepath?: string }>();
    const npeFileName = useAtomValue(activeNpeOpTraceAtom);
    const { data: loadedData, isLoading: isLoadingNPE, error: processingError } = useNpe(npeFileName);
    const { data: loadedTimeline, isLoading: isLoadingTimeline } = useNPETimelineFile(filepath);
    const [demoData, setDemoData] = useState<NPEData | null>(null);
    const [selectedDemo, setSelectedDemo] = useState<NPEDemoData | null>(null);

    // Determine the current NPE data source
    const npeData = demoData || loadedData || loadedTimeline;
    const isDemoEnabled = getServerConfig()?.SERVER_MODE;
    const matchedVersion = matchNpeDataVersion(npeData?.common_info?.version);
    const hasUploadedFile = !!npeFileName || !!filepath;
    const isLoading = isLoadingNPE || isLoadingTimeline;

    useEffect(() => {
        if (loadedData || loadedTimeline) {
            setSelectedDemo(null);
            setDemoData(null);
        }
    }, [loadedData, loadedTimeline]);

    return (
        <>
            <Helmet>
                <title>NPE</title>
                <meta
                    name='description'
                    content='NPE performance estimator'
                />
            </Helmet>

            <h1 className='page-title'>NOC performance estimator</h1>
            <div className='npe-inline-loaders'>
                {!filepath && <NPEFileLoader />}

                {isDemoEnabled && (
                    <>
                        <NPEDemoSelect
                            selectedDemo={selectedDemo}
                            setSelectedDemo={setSelectedDemo}
                            setDemoData={setDemoData}
                        />
                        <br />
                    </>
                )}
            </div>

            {isLoading && <LoadingSpinner />}

            {!isLoading && !hasUploadedFile && (
                <div className='npe-message-container'>
                    <Callout compact>See {NPE_REPO_URL} for details on how to generate NPE report files.</Callout>
                </div>
            )}

            {hasUploadedFile && npeData && isValidNpeData(npeData) && !processingError && <NPEView npeData={npeData} />}

            {hasUploadedFile && (processingError || npeData) && (
                <div className='npe-message-container'>
                    <NPEProcessingStatus
                        matchedVersion={matchedVersion}
                        expectedVersion={NPE_DATA_VERSION}
                        npeData={npeData}
                        fetchError={processingError}
                    />
                </div>
            )}
        </>
    );
};

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

const matchNpeDataVersion = (version?: string): string | null => {
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
