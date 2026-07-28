// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from 'react';
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
import NpeWindowedView from '../components/npe/NpeWindowedView';
import { NPEValidationError } from '../definitions/NPEData';
import { validateNpeData } from '../functions/validateNpeData';

const NPE = () => {
    const { filepath } = useParams<{ filepath?: string }>();
    const npeFileName = useAtomValue(activeNpeOpTraceAtom);
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    // #861: for uploaded reports the windowed view replaces the whole-file path,
    // skipping `useNpe` (its full /api/npe fetch is exactly what fails on large
    // files) and rendering NPEView from per-timestep windowed fetches instead.
    // Enabled in both local dev and local prod, disabled under SERVER_MODE — the
    // same boundary as the @local_only gate on /api/npe/{summary,window}, whose
    // sidecar build isn't hosted-safe yet (#1802). Hosted keeps the whole-file
    // path; exit criterion is deciding hosted-safety, then dropping the fork.
    const isWindowedView = !isServerMode && !filepath && !!npeFileName;
    const {
        data: loadedData,
        isLoading: isLoadingNPE,
        error: httpError,
    } = useNpe(filepath || isWindowedView ? null : npeFileName);
    const {
        data: loadedTimeline,
        isLoading: isLoadingTimeline,
        error: timelineHttpError,
    } = useNPETimelineFile(filepath);
    const [demoData, setDemoData] = useState<NPEData | null>(null);
    const [selectedDemo, setSelectedDemo] = useState<NPEDemoData | null>(null);

    const npeData = useMemo(() => demoData || loadedData || loadedTimeline, [demoData, loadedData, loadedTimeline]);

    const isDemoEnabled = isServerMode;
    const isLoading = isLoadingNPE || isLoadingTimeline;
    const hasUploadedFile = !!npeFileName || !!filepath;

    const errorCode = useMemo(() => {
        if (isLoading) {
            return NPEValidationError.OK;
        }

        if (
            httpError?.status === HttpStatusCode.UnprocessableEntity ||
            timelineHttpError?.status === HttpStatusCode.UnprocessableEntity
        ) {
            return NPEValidationError.INVALID_JSON;
        }

        if (httpError?.status !== undefined && httpError?.status >= HttpStatusCode.BadRequest) {
            return NPEValidationError.DEFAULT;
        }
        if (timelineHttpError?.status !== undefined && timelineHttpError?.status >= HttpStatusCode.BadRequest) {
            return NPEValidationError.DEFAULT;
        }

        return validateNpeData(npeData);
    }, [isLoading, httpError?.status, timelineHttpError?.status, npeData]);

    useEffect(() => {
        if (loadedData || loadedTimeline) {
            // Has sufficient guard conditions
            // eslint-disable-next-line react-hooks/set-state-in-effect
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
            <div className='inline-loaders'>
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

            {isWindowedView ? (
                // key on the report so a report switch fully remounts: resets the
                // selected timestep + auto-jump ref and gives fresh query observers
                // (no keepPreviousData bleed from the previous report's window).
                <NpeWindowedView
                    key={npeFileName}
                    fileName={npeFileName}
                />
            ) : (
                <>
                    {errorCode !== NPEValidationError.OK ? (
                        <NPEProcessingStatus
                            errorCode={errorCode}
                            dataVersion={npeData?.common_info?.version || null}
                            isLoading={isLoading}
                            hasUploadedFile={hasUploadedFile}
                        />
                    ) : (
                        npeData && <NPEView npeData={npeData} />
                    )}
                </>
            )}
        </>
    );
};

export default NPE;
