// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useRef, useState } from 'react';
import { Callout, Intent, Spinner } from '@blueprintjs/core';
import { useNpeSummary, useNpeWindow } from '../../hooks/useAPI';
import assembleWindowedNpeData, { buildTimestepSkeleton } from '../../functions/assembleWindowedNpeData';
import getResponseError from '../../functions/getResponseError';
import NPEView from './NPEViewComponent';

interface NpeWindowedViewProps {
    fileName: string | null;
}

// #861 PoC container: drives the selected timestep, fetches only that step's
// window, and feeds an assembled NPEData into the unchanged NPEView. Scrubbing
// updates `selectedTimestep`, which refetches the next window.
const NpeWindowedView = ({ fileName }: NpeWindowedViewProps) => {
    const [selectedTimestep, setSelectedTimestep] = useState(0);
    const didInitTimestep = useRef(false);
    const {
        data: summary,
        isLoading: isLoadingSummary,
        isError: isSummaryError,
        error: summaryError,
    } = useNpeSummary(fileName);
    const { data: npeWindow, isError: isWindowError, error: windowError } = useNpeWindow(fileName, selectedTimestep);

    // Open on the first populated timestep (t=0 is commonly idle).
    useEffect(() => {
        if (summary && !didInitTimestep.current) {
            didInitTimestep.current = true;
            const firstActive = summary.timesteps.active_count.findIndex((count) => count > 0);
            if (firstActive > 0) {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setSelectedTimestep(firstActive);
            }
        }
    }, [summary]);

    // Stable per-step aggregate skeleton for the timeline, built once per summary
    // so scrubbing neither rebuilds ~54k step objects nor churns the timeline's
    // O(n_timesteps) heat-bar memo.
    const baseTimestepData = useMemo(() => (summary ? buildTimestepSkeleton(summary) : null), [summary]);

    // Assemble at `selectedTimestep` (not `npeWindow.t`) so an in-flight seek keeps
    // the previous frame on the rendered step instead of flashing empty.
    const npeData = useMemo(
        () =>
            summary && npeWindow && baseTimestepData
                ? assembleWindowedNpeData(summary, npeWindow, baseTimestepData, selectedTimestep)
                : null,
        [summary, npeWindow, baseTimestepData, selectedTimestep],
    );

    if (!fileName) {
        return null;
    }

    // A failed summary (index build) is fatal — there is no trace to render.
    if (isSummaryError) {
        return (
            <Callout
                intent={Intent.DANGER}
                title='Unable to load NPE report'
            >
                {getResponseError(summaryError)}
            </Callout>
        );
    }

    // No frame yet: surface a first-window failure instead of trapping the user on
    // an infinite spinner; otherwise the index/first window is still loading.
    if (!npeData) {
        if (isWindowError) {
            return (
                <Callout
                    intent={Intent.DANGER}
                    title='Unable to load NPE timestep'
                >
                    {getResponseError(windowError)}
                </Callout>
            );
        }
        return (
            <div className='npe-windowed-loading'>
                <Spinner size={20} />
                <span>{isLoadingSummary ? 'Processing…' : 'Loading timestep…'}</span>
            </div>
        );
    }

    // A frame is available. If the current seek's window failed, degrade in place:
    // keep the summary + scrubber (so the user can seek elsewhere and recover) and
    // show a non-blocking notice rather than replacing the whole view with an
    // unrecoverable error box.
    return (
        <>
            {isWindowError && (
                <Callout
                    intent={Intent.WARNING}
                    title='Timestep failed to load'
                >
                    Showing the last loaded timestep. {getResponseError(windowError)}
                </Callout>
            )}
            <NPEView
                npeData={npeData}
                timelineData={baseTimestepData ?? undefined}
                selectedTimestep={selectedTimestep}
                onSelectedTimestepChange={setSelectedTimestep}
                reportKey={fileName}
            />
        </>
    );
};

export default NpeWindowedView;
