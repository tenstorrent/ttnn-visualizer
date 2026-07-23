// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NPE_FETCH_TIMEOUT_MS, NPE_RENDER_TIMEOUT_MS } from '../definitions/NPEData';
import { discardNpeQueries } from './useAPI';

const hasExceededBudget = (startedAt: number | null, budgetMs: number): boolean =>
    startedAt !== null && performance.now() - startedAt > budgetMs;

interface UseNpeLoadRenderLifecycleArgs {
    /** Report identity — any change resets load/render gates. */
    npeFileName: string | null;
    filepath: string | undefined;
    selectedDemoKey: string | null;
    isFetchingData: boolean;
    /** Valid payload present (excludes load/render timeout gates). */
    hasValidData: boolean;
}

interface UseNpeLoadRenderLifecycleResult {
    isRendering: boolean;
    isLoading: boolean;
    isDataReady: boolean;
    loadTimedOut: boolean;
    renderTimedOut: boolean;
    mountView: boolean;
    handleViewRendered: () => void;
}

/**
 * Owns NPE load/render wall-clock budgets, deferred mount, and query discard on timeout.
 * Load vs render stay separate: fetch settle vs onRendered, with deferred mountView.
 */
const useNpeLoadRenderLifecycle = ({
    npeFileName,
    filepath,
    selectedDemoKey,
    isFetchingData,
    hasValidData,
}: UseNpeLoadRenderLifecycleArgs): UseNpeLoadRenderLifecycleResult => {
    const queryClient = useQueryClient();
    const [hasRenderedView, setHasRenderedView] = useState(false);
    const [mountView, setMountView] = useState(false);
    const [loadTimedOut, setLoadTimedOut] = useState(false);
    const [renderTimedOut, setRenderTimedOut] = useState(false);
    const hasRenderedViewRef = useRef(false);
    const isFetchingDataRef = useRef(false);
    const loadStartedAtRef = useRef<number | null>(null);
    const renderStartedAtRef = useRef<number | null>(null);

    const isDataReady = hasValidData && !loadTimedOut;
    // Show "Rendering…" as soon as data is ready — not only after mountView flips.
    const isRendering = isDataReady && !hasRenderedView && !renderTimedOut;
    const isLoading = (!loadTimedOut && !renderTimedOut && isFetchingData) || isRendering;

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
    }, [npeFileName, filepath, selectedDemoKey]);

    // Wall-clock bound for Processing (download + parse). Axios timeout only
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
    }, [isFetchingData, loadTimedOut, npeFileName, filepath, selectedDemoKey, queryClient]);

    // If sync parse blocked the timer, fail once fetching settles over budget.
    useEffect(() => {
        if (isFetchingData || loadTimedOut) {
            return;
        }

        const startedAt = loadStartedAtRef.current;
        if (startedAt === null) {
            return;
        }

        if (hasExceededBudget(startedAt, NPE_FETCH_TIMEOUT_MS)) {
            handleLoadTimeout();
            return;
        }

        loadStartedAtRef.current = null;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- settle keyed on fetch/report identity
    }, [isFetchingData, loadTimedOut, npeFileName, filepath, selectedDemoKey, queryClient]);

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
    }, [isDataReady, hasRenderedView, renderTimedOut, npeFileName, filepath, selectedDemoKey, queryClient]);

    const handleViewRendered = () => {
        // Stop the async timer from racing a second timeout decision.
        hasRenderedViewRef.current = true;
        if (hasExceededBudget(renderStartedAtRef.current, NPE_RENDER_TIMEOUT_MS)) {
            handleRenderTimeout();
            return;
        }
        setHasRenderedView(true);
    };

    return {
        isRendering,
        isLoading,
        isDataReady,
        loadTimedOut,
        renderTimedOut,
        mountView,
        handleViewRendered,
    };
};

export default useNpeLoadRenderLifecycle;
