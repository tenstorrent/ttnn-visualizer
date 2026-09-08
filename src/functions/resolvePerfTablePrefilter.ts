// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfTablePrefilterOptions } from '../definitions/PerformanceCharts';
import { toggleListMembership } from './toggleListMembership';

export interface ResolvedPerfTablePrefilter<T extends string | number> {
    selection: T[];
    /** Replacing the selection moves the user to the table showing it; amending stays put. */
    shouldShowPerfTable: boolean;
}

/**
 * Replace, add, remove and clear for the chart-driven table prefilters, in one place so the op code
 * and duration bucket hooks cannot drift and no caller has to re-derive the rule from an atom it
 * only reads for rendering.
 *
 * Shift makes the gesture additive. A plain click replaces, except on the only selected value the
 * caller can see, which clears — see `visibleValues` for why that is not the same as the only
 * selected value in the filter. Clearing is offered only to callers that declare `visibleValues`,
 * because it is the affordance of a control that renders its own selected state: a caller that
 * cannot say what it drew cannot have shown the user the selection they are clicking off.
 */
export function resolvePerfTablePrefilter<T extends string | number>(
    current: readonly T[],
    value: T,
    options?: PerfTablePrefilterOptions<T>,
): ResolvedPerfTablePrefilter<T> {
    const { additive, visibleValues } = options ?? {};
    const visibleSelection = visibleValues?.filter((entry) => current.includes(entry)) ?? [];
    const isSoleVisibleSelection = visibleSelection.length === 1 && visibleSelection[0] === value;
    const isAdditive = Boolean(additive) || isSoleVisibleSelection;

    return {
        // Toggling against the full selection rather than the visible one: the click speaks for the
        // control the user hit, and leaves any value another view contributed alone.
        selection: isAdditive ? toggleListMembership(current, value) : [value],
        shouldShowPerfTable: !isAdditive,
    };
}
