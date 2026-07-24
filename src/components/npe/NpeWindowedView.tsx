// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useRef, useState } from 'react';
import { Callout, Intent, Spinner } from '@blueprintjs/core';
import { useNpeSummary, useNpeWindow } from '../../hooks/useAPI';
import assembleWindowedNpeData from '../../functions/assembleWindowedNpeData';
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

    // Assemble at `selectedTimestep` (not `npeWindow.t`) so an in-flight seek keeps
    // the previous frame on the rendered step instead of flashing empty.
    const npeData = useMemo(
        () => (summary && npeWindow ? assembleWindowedNpeData(summary, npeWindow, selectedTimestep) : null),
        [summary, npeWindow, selectedTimestep],
    );

    if (!fileName) {
        return null;
    }

    // Surface index-build / window failures instead of trapping the user on an
    // infinite "Building index…" spinner.
    if (isSummaryError || isWindowError) {
        return (
            <Callout
                intent={Intent.DANGER}
                title='Unable to load NPE report'
            >
                {getResponseError(summaryError ?? windowError)}
            </Callout>
        );
    }

    if (!npeData) {
        return (
            <div className='npe-windowed-loading'>
                <Spinner size={20} />
                <span>{isLoadingSummary ? 'Building index…' : 'Loading timestep…'}</span>
            </div>
        );
    }

    return (
        <NPEView
            npeData={npeData}
            selectedTimestep={selectedTimestep}
            onSelectedTimestepChange={setSelectedTimestep}
            reportKey={fileName}
        />
    );
};

export default NpeWindowedView;
