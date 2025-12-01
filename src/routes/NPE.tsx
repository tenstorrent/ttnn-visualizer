// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { useParams } from 'react-router';
import { HttpStatusCode } from 'axios';
import NPEFileLoader from '../components/npe/NPEFileLoader';
import NPEView from '../components/npe/NPEViewComponent';
import { useNPETimelineFile, useNpe } from '../hooks/useAPI';
import { activeNpeOpTraceAtom } from '../store/app';
import { NPEData } from '../model/NPEModel';
import getServerConfig from '../functions/getServerConfig';
import NPEProcessingStatus from '../components/NPEProcessingStatus';
import NPEDemoSelect, { NPEDemoData } from '../components/npe/NPEDemoSelect';
import { NPEValidationError, validateNpeData } from '../definitions/NPEData';

const NPE: FC = () => {
    const { filepath } = useParams<{ filepath?: string }>();
    const npeFileName = useAtomValue(activeNpeOpTraceAtom);
    const { data: loadedData, isLoading: isLoadingNPE, error: httpError } = useNpe(npeFileName);
    const { data: loadedTimeline, isLoading: isLoadingTimeline } = useNPETimelineFile(filepath);
    const [demoData, setDemoData] = useState<NPEData | null>(null);
    const [selectedDemo, setSelectedDemo] = useState<NPEDemoData | null>(null);

    const npeData = useMemo(() => demoData || loadedData || loadedTimeline, [demoData, loadedData, loadedTimeline]);

    const isDemoEnabled = getServerConfig()?.SERVER_MODE;
    const isLoading = isLoadingNPE || isLoadingTimeline;
    const hasUploadedFile = !!npeFileName || !!filepath;

    const errorCode = useMemo(() => {
        if (isLoading) {
            return NPEValidationError.OK;
        }
        if (httpError?.status === HttpStatusCode.UnprocessableEntity) {
            return NPEValidationError.INVALID_JSON;
        }

        if (httpError?.status !== undefined && httpError?.status >= HttpStatusCode.BadRequest) {
            return NPEValidationError.DEFAULT;
        }

        return validateNpeData(npeData);
    }, [isLoading, httpError?.status, npeData]);

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

            {errorCode !== NPEValidationError.OK ? (
                <NPEProcessingStatus
                    errorType={errorCode}
                    dataVersion={npeData?.common_info?.version || null}
                    isLoading={isLoading}
                    hasUploadedFile={hasUploadedFile}
                />
            ) : (
                npeData && <NPEView npeData={npeData} />
            )}
        </>
    );
};

export default NPE;
