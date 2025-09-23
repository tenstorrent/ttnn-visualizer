/* eslint-disable no-nested-ternary */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
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
import NPEDemoSelect, { NPEDemoData } from '../components/npe/NPEDemoSelect';
import { NPE_DATA_VERSION } from '../definitions/NPEData';

const NPE: FC = () => {
    const { filepath } = useParams<{ filepath?: string }>();
    const npeFileName = useAtomValue(activeNpeOpTraceAtom);
    const { data: loadedData, isLoading: isLoadingNPE, error: processingError } = useNpe(npeFileName);
    const { data: loadedTimeline, isLoading: isLoadingTimeline } = useNPETimelineFile(filepath);
    const [demoData, setDemoData] = useState<NPEData | null>(null);
    const [selectedDemo, setSelectedDemo] = useState<NPEDemoData | null>(null);

    // Determine the current NPE data source
    const npeData = useMemo(() => demoData || loadedData || loadedTimeline, [demoData, loadedData, loadedTimeline]);
    const isDemoEnabled = getServerConfig()?.SERVER_MODE;
    const isLoading = isLoadingNPE || isLoadingTimeline;
    const hasUploadedFile = !!npeFileName || !!filepath;
    const dataVersion = npeData?.common_info?.version || null;

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

            {isLoading || isLoadingTimeline ? (
                <div>
                    <LoadingSpinner />
                </div>
            ) : npeData ? (
                isValidNpeData(npeData) ? (
                    <NPEView npeData={npeData} />
                ) : (
                    <NPEProcessingStatus
                        dataVersion={dataVersion}
                        hasUploadedFile={hasUploadedFile}
                        isInvalidData
                    />
                )
            ) : (
                <NPEProcessingStatus
                    dataVersion={dataVersion}
                    hasUploadedFile={hasUploadedFile}
                    fetchErrorCode={processingError?.status}
                    isInvalidData
                />
            )}
        </>
    );
};

const isValidNpeData = (data: NPEData): boolean => {
    if (typeof data !== 'object' || data === null || data === undefined) {
        return false;
    }
    const requiredKeys: (keyof NPEData)[] = ['common_info', 'noc_transfers', 'timestep_data'];
    const hasAllKeys = requiredKeys.every((key) => key in data);
    const version = semverParse(data.common_info.version);
    const expectedVersion = semverParse(NPE_DATA_VERSION);

    if (!hasAllKeys || version?.major !== expectedVersion?.major) {
        return false;
    }

    return true;
};

export default NPE;
