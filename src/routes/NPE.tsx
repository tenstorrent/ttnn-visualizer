// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { useParams } from 'react-router';
import { AxiosError, HttpStatusCode } from 'axios';
import classNames from 'classnames';
import NPEFileLoader from '../components/npe/NPEFileLoader';
import NPEView from '../components/npe/NPEViewComponent';
import { useNPETimelineFile, useNpe } from '../hooks/useAPI';
import useNpeLoadRenderLifecycle from '../hooks/useNpeLoadRenderLifecycle';
import { activeNpeOpTraceAtom } from '../store/app';
import { NPEData } from '../model/NPEModel';
import getServerConfig from '../functions/getServerConfig';
import NPEProcessingStatus from '../components/NPEProcessingStatus';
import NPEDemoSelect, { NPEDemoData } from '../components/npe/NPEDemoSelect';
import { NPEValidationError, NpeAxiosErrorCode } from '../definitions/NPEData';
import { validateNpeData } from '../functions/validateNpeData';
import 'styles/components/NPEComponent.scss';

const isNpeFetchTimeout = (error: AxiosError | null): boolean =>
    error?.code === AxiosError.ECONNABORTED || error?.code === AxiosError.ETIMEDOUT;

const isNpePayloadTooLarge = (error: AxiosError | null): boolean => error?.code === NpeAxiosErrorCode.PAYLOAD_TOO_LARGE;

const isNpeInvalidJson = (error: AxiosError | null): boolean =>
    error?.code === NpeAxiosErrorCode.INVALID_JSON || error?.code === AxiosError.ERR_BAD_RESPONSE;

const NPE = () => {
    const { filepath } = useParams<{ filepath?: string }>();
    const npeFileName = useAtomValue(activeNpeOpTraceAtom);
    // Only one of these queries is enabled at a time; scope "loading" to the
    // active one so a disabled sibling cannot keep the spinner up after restore.
    const isNpeQueryEnabled = !filepath && npeFileName !== null;
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

    const isDemoEnabled = getServerConfig()?.SERVER_MODE;
    // Prefer RQ isLoading (isPending && isFetching) over bare isFetching so a
    // background refetch cannot pin the spinner after data is already present.
    const isFetchingData = (isNpeQueryEnabled && isLoadingNpe) || (isTimelineQueryEnabled && isLoadingTimeline);
    const hasUploadedFile = !!npeFileName || !!filepath;

    // Only one query is enabled; prefer the active error without OR-ing both.
    const fetchError = httpError ?? timelineHttpError;

    const fetchErrorCode = useMemo(() => {
        if (isFetchingData) {
            return NPEValidationError.OK;
        }

        if (isNpeFetchTimeout(fetchError)) {
            return NPEValidationError.LOAD_TIMEOUT;
        }

        if (isNpePayloadTooLarge(fetchError)) {
            return NPEValidationError.PAYLOAD_TOO_LARGE;
        }

        if (isNpeInvalidJson(fetchError) || fetchError?.status === HttpStatusCode.UnprocessableEntity) {
            return NPEValidationError.INVALID_JSON;
        }

        if (fetchError?.status !== undefined && fetchError.status >= HttpStatusCode.BadRequest) {
            return NPEValidationError.DEFAULT;
        }

        return validateNpeData(npeData);
    }, [isFetchingData, fetchError, npeData]);

    const hasValidData = !isFetchingData && !!npeData && fetchErrorCode === NPEValidationError.OK;
    const { isRendering, isLoading, isDataReady, loadTimedOut, renderTimedOut, mountView, handleViewRendered } =
        useNpeLoadRenderLifecycle({
            npeFileName,
            filepath,
            selectedDemoKey: selectedDemo?.reportFile ?? null,
            isFetchingData,
            hasValidData,
        });

    let errorCode = fetchErrorCode;
    if (renderTimedOut) {
        errorCode = NPEValidationError.RENDER_TIMEOUT;
    } else if (loadTimedOut) {
        errorCode = NPEValidationError.LOAD_TIMEOUT;
    }

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

            {showStatus && (
                <NPEProcessingStatus
                    errorCode={errorCode}
                    dataVersion={npeData?.common_info?.version || null}
                    isLoading={isLoading}
                    isRendering={isRendering}
                    hasUploadedFile={hasUploadedFile}
                />
            )}

            {isDataReady && mountView && !renderTimedOut && npeData && (
                <div
                    // Keep the view mounted (and measurable) while the spinner
                    // shows, but avoid a flash of unfinished chrome.
                    className={classNames({ 'npe-view-prepaint': isRendering })}
                    aria-hidden={isRendering}
                >
                    <NPEView
                        npeData={npeData}
                        onRendered={handleViewRendered}
                    />
                </div>
            )}
        </>
    );
};

export default NPE;
