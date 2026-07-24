// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useRef, useState } from 'react';
import { Callout, NumericInput } from '@blueprintjs/core';
import { useNpeSummary, useNpeWindow } from '../../hooks/useAPI';
import assembleWindowedNpeData from '../../functions/assembleWindowedNpeData';
import { validateNpeData } from '../../functions/validateNpeData';
import { NPEValidationError } from '../../definitions/NPEData';

interface NpeWindowedProofProps {
    fileName: string | null;
}

// Dev-only proof surface for #861 windowed NPE loading. Exercises the
// summary + window endpoints and confirms the assembled NPEData is
// renderer-valid, without wiring the windowed data into NPEView (deferred
// with the renderer work).
const NpeWindowedProof = ({ fileName }: NpeWindowedProofProps) => {
    const [timestep, setTimestep] = useState(0);
    const didInitTimestep = useRef(false);
    const { data: summary, isLoading: isLoadingSummary } = useNpeSummary(fileName);
    const { data: npeWindow, isFetching: isFetchingWindow } = useNpeWindow(fileName, timestep);

    // Open on the first timestep that actually has active transfers — t=0 is
    // commonly idle, which would otherwise look like a failure.
    useEffect(() => {
        if (summary && !didInitTimestep.current) {
            didInitTimestep.current = true;
            const firstActive = summary.timesteps.find((step) => step.active_count > 0);
            if (firstActive && firstActive.t !== 0) {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setTimestep(firstActive.t);
            }
        }
    }, [summary]);

    const assembledValid = useMemo(() => {
        if (!summary || !npeWindow) {
            return null;
        }
        return validateNpeData(assembleWindowedNpeData(summary, npeWindow)) === NPEValidationError.OK;
    }, [summary, npeWindow]);

    if (!fileName) {
        return null;
    }

    const maxTimestep = summary ? Math.max(summary.n_timesteps - 1, 0) : 0;
    const activeCount = npeWindow?.timestep.active_transfers.length ?? 0;
    const windowKb = npeWindow ? Math.round(JSON.stringify(npeWindow).length / 1024) : 0;

    return (
        <Callout
            title='NPE windowed loading — PoC (#861)'
            compact
        >
            {isLoadingSummary && <p>Building / loading index…</p>}
            {summary && (
                <ul>
                    <li>timesteps: {summary.n_timesteps.toLocaleString()}</li>
                    <li>arch: {summary.common_info.arch}</li>
                    <li>chips: {Object.keys(summary.chips).length}</li>
                </ul>
            )}
            <label>
                Timestep{' '}
                <NumericInput
                    value={timestep}
                    min={0}
                    max={maxTimestep}
                    clampValueOnBlur
                    onValueChange={(value) => setTimestep(Number.isFinite(value) ? value : 0)}
                />
            </label>
            {isFetchingWindow && <p>Fetching window…</p>}
            {npeWindow && (
                <ul>
                    <li>active transfers: {activeCount}</li>
                    <li>resolved transfers: {npeWindow.transfers.length}</li>
                    <li>window payload: {windowKb} KB</li>
                    <li>
                        {activeCount === 0
                            ? 'empty timestep (no active transfers)'
                            : `assembled NPEData renderer-valid: ${String(assembledValid)}`}
                    </li>
                </ul>
            )}
        </Callout>
    );
};

export default NpeWindowedProof;
