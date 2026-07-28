// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { useParams } from 'react-router';
import NPEFileLoader from '../components/npe/NPEFileLoader';
import NPEView from '../components/npe/NPEViewComponent';
import NpeWindowedView from '../components/npe/NpeWindowedView';
import { useNPETimelineFile, useNpe } from '../hooks/useAPI';
import { activeNpeOpTraceAtom } from '../store/app';
import { NPEData } from '../model/NPEModel';
import getServerConfig from '../functions/getServerConfig';
import NPEProcessingStatus from '../components/NPEProcessingStatus';
import NPEDemoSelect, { NPEDemoData } from '../components/npe/NPEDemoSelect';
import { NPEValidationError } from '../definitions/NPEData';
import { mapNpeFetchError } from '../functions/mapNpeFetchError';
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
    // Only one of these queries is enabled at a time; scope "loading" to the
    // active one so a disabled sibling cannot keep the spinner up after restore.
    // Windowed uploads skip useNpe entirely (#861).
    const isNpeQueryEnabled = !filepath && !isWindowedView && npeFileName !== null;
    const isTimelineQueryEnabled = Boolean(filepath);
    const {
        data: loadedData,
        isLoading: isLoadingNpe,
        error: httpError,
    } = useNpe(isNpeQueryEnabled ? npeFileName : null);
    const {
        data: loadedTimeline,
        isLoading: isLoadingTimeline,
        error: timelineHttpError,
    } = useNPETimelineFile(filepath);
    const [demoData, setDemoData] = useState<NPEData | null>(null);
    const [selectedDemo, setSelectedDemo] = useState<NPEDemoData | null>(null);

    const npeData = useMemo(() => demoData || loadedData || loadedTimeline, [demoData, loadedData, loadedTimeline]);

    const isDemoEnabled = isServerMode;
    // Prefer RQ isLoading (isPending && isFetching) over bare isFetching so a
    // background refetch cannot pin the spinner after data is already present.
    const isLoading = (isNpeQueryEnabled && isLoadingNpe) || (isTimelineQueryEnabled && isLoadingTimeline);
    const hasUploadedFile = !!npeFileName || !!filepath;

    // Only one query is enabled; prefer the active error without OR-ing both.
    const fetchError = httpError ?? timelineHttpError;

    const errorCode = useMemo(() => {
        if (isLoading) {
            return NPEValidationError.OK;
        }

        return mapNpeFetchError(fetchError) ?? validateNpeData(npeData);
    }, [isLoading, fetchError, npeData]);

    useEffect(() => {
        if (loadedData || loadedTimeline) {
            // Has sufficient guard conditions
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedDemo(null);
            setDemoData(null);
        }
    }, [loadedData, loadedTimeline]);

    const showStatus = isLoading || !npeData || errorCode !== NPEValidationError.OK;

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
                    {showStatus && (
                        <NPEProcessingStatus
                            errorCode={errorCode}
                            dataVersion={npeData?.common_info?.version || null}
                            isLoading={isLoading}
                            hasUploadedFile={hasUploadedFile}
                        />
                    )}

                    {!isLoading && errorCode === NPEValidationError.OK && npeData && <NPEView npeData={npeData} />}
                </>
            )}
        </>
    );
};

export default NPE;
