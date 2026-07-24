// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@blueprintjs/core';
import { useNpeSummary, useNpeWindow } from '../../hooks/useAPI';
import assembleWindowedNpeData from '../../functions/assembleWindowedNpeData';
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
    const { data: summary, isLoading: isLoadingSummary } = useNpeSummary(fileName);
    const { data: npeWindow } = useNpeWindow(fileName, selectedTimestep);

    // Open on the first populated timestep (t=0 is commonly idle).
    useEffect(() => {
        if (summary && !didInitTimestep.current) {
            didInitTimestep.current = true;
            const firstActive = summary.timesteps.find((step) => step.active_count > 0);
            if (firstActive && firstActive.t !== 0) {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setSelectedTimestep(firstActive.t);
            }
        }
    }, [summary]);

    const npeData = useMemo(
        () => (summary && npeWindow ? assembleWindowedNpeData(summary, npeWindow) : null),
        [summary, npeWindow],
    );

    if (!fileName) {
        return null;
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
