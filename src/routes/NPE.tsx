// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AxiosError, HttpStatusCode } from 'axios';
import NPEFileLoader from '../components/npe/NPEFileLoader';
import NPEView from '../components/npe/NPEViewComponent';
import { discardNpeQueries, useNPETimelineFile, useNpe } from '../hooks/useAPI';
import { activeNpeOpTraceAtom } from '../store/app';
import { NPEData } from '../model/NPEModel';
import getServerConfig from '../functions/getServerConfig';
import NPEProcessingStatus from '../components/NPEProcessingStatus';
import NPEDemoSelect, { NPEDemoData } from '../components/npe/NPEDemoSelect';
import {
    NPEValidationError,
    NPE_FETCH_TIMEOUT_MS,
    NPE_RENDER_TIMEOUT_MS,
    NpeAxiosErrorCode,
} from '../definitions/NPEData';
import { validateNpeData } from '../functions/validateNpeData';

const isNpeFetchTimeout = (error: AxiosError | null): boolean =>
    error?.code === AxiosError.ECONNABORTED || error?.code === AxiosError.ETIMEDOUT;

const isNpePayloadTooLarge = (error: AxiosError | null): boolean => error?.code === NpeAxiosErrorCode.PAYLOAD_TOO_LARGE;

const isNpeInvalidJson = (error: AxiosError | null): boolean =>
    error?.code === NpeAxiosErrorCode.INVALID_JSON || error?.code === AxiosError.ERR_BAD_RESPONSE;

const NPE = () => {
    const queryClient = useQueryClient();
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
    const [hasRenderedView, setHasRenderedView] = useState(false);
    const [mountView, setMountView] = useState(false);
    const [loadTimedOut, setLoadTimedOut] = useState(false);
    const [renderTimedOut, setRenderTimedOut] = useState(false);
    const hasRenderedViewRef = useRef(false);
    const isFetchingDataRef = useRef(false);
    const loadStartedAtRef = useRef<number | null>(null);
    const renderStartedAtRef = useRef<number | null>(null);

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

    const isDataReady = !loadTimedOut && !isFetchingData && !!npeData && fetchErrorCode === NPEValidationError.OK;
    // Show "Rendering…" as soon as data is ready — not only after mountView flips.
    const isRendering = isDataReady && !hasRenderedView && !renderTimedOut;
    const isLoading = (!loadTimedOut && !renderTimedOut && isFetchingData) || isRendering;
    let errorCode = fetchErrorCode;
    if (renderTimedOut) {
        errorCode = NPEValidationError.RENDER_TIMEOUT;
    } else if (loadTimedOut) {
        errorCode = NPEValidationError.LOAD_TIMEOUT;
    }

    const handleLoadTimeout = () => {
        setLoadTimedOut(true);
        discardNpeQueries(queryClient);
    };

    const handleRenderTimeout = () => {
        setRenderTimedOut(true);
        setMountView(false);
        discardNpeQueries(queryClient);
    };

    useEffect(() => {
        isFetchingDataRef.current = isFetchingData;
    }, [isFetchingData]);

    // Reset load/render gates whenever the active report identity changes.
    useEffect(() => {
        hasRenderedViewRef.current = false;
        loadStartedAtRef.current = null;
        renderStartedAtRef.current = null;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset gates when report identity changes
        setHasRenderedView(false);
        setMountView(false);
        setLoadTimedOut(false);
        setRenderTimedOut(false);
    }, [npeFileName, filepath, selectedDemo]);

    // Wall-clock bound for "Loading NPE…" (download + parse). Axios timeout only
    // covers the HTTP wait; JSON.parse of a huge body is sync and can hang the
    // spinner after the response has already arrived — same pattern as render.
    useEffect(() => {
        if (!isFetchingData || loadTimedOut) {
            return undefined;
        }

        if (loadStartedAtRef.current === null) {
            loadStartedAtRef.current = performance.now();
        }

        const timeoutId = window.setTimeout(() => {
            if (isFetchingDataRef.current) {
                handleLoadTimeout();
            }
        }, NPE_FETCH_TIMEOUT_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
        // handleLoadTimeout closes over queryClient; identity resets already re-run this effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- timeout budget keyed on fetch/report identity
    }, [isFetchingData, loadTimedOut, npeFileName, filepath, selectedDemo, queryClient]);

    // If sync parse blocked the timer, fail once fetching settles over budget.
    useEffect(() => {
        if (isFetchingData || loadTimedOut) {
            return;
        }

        const startedAt = loadStartedAtRef.current;
        if (startedAt === null) {
            return;
        }

        if (performance.now() - startedAt > NPE_FETCH_TIMEOUT_MS) {
            handleLoadTimeout();
            return;
        }

        loadStartedAtRef.current = null;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- settle keyed on fetch/report identity
    }, [isFetchingData, loadTimedOut, npeFileName, filepath, selectedDemo, queryClient]);

    // Defer mounting the heavy view so the spinner can paint before the main
    // thread enters NPEView work. A wall-clock timer alone cannot bound sync
    // render cost (the event loop is blocked), so handleViewRendered also
    // compares elapsed time when the first commit finally lands.
    useEffect(() => {
        if (!isDataReady || hasRenderedView || renderTimedOut) {
            return undefined;
        }

        renderStartedAtRef.current = performance.now();
        const mountId = window.setTimeout(() => {
            setMountView(true);
        }, 0);
        // Covers async hangs where the event loop stays free but onRendered never fires.
        const timeoutId = window.setTimeout(() => {
            if (!hasRenderedViewRef.current) {
                handleRenderTimeout();
            }
        }, NPE_RENDER_TIMEOUT_MS);

        return () => {
            window.clearTimeout(mountId);
            window.clearTimeout(timeoutId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- render budget keyed on data/report identity
    }, [isDataReady, hasRenderedView, renderTimedOut, npeFileName, filepath, selectedDemo, queryClient]);

    useEffect(() => {
        if (loadedData || loadedTimeline) {
            // Has sufficient guard conditions
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedDemo(null);
            setDemoData(null);
        }
    }, [loadedData, loadedTimeline]);

    const handleViewRendered = () => {
        // Stop the async timer from racing a second timeout decision.
        hasRenderedViewRef.current = true;
        const startedAt = renderStartedAtRef.current;
        if (startedAt !== null && performance.now() - startedAt > NPE_RENDER_TIMEOUT_MS) {
            handleRenderTimeout();
            return;
        }
        setHasRenderedView(true);
    };

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

            {isDataReady && mountView && !renderTimedOut && (
                <div
                    // Keep the view mounted (and measurable) while the spinner
                    // shows, but avoid a flash of unfinished chrome.
                    style={hasRenderedView ? undefined : { visibility: 'hidden', position: 'absolute' }}
                    aria-hidden={!hasRenderedView}
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
