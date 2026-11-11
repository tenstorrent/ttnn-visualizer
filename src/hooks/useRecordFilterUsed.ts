// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useRef } from 'react';
import { FilterSurface } from '../definitions/EventLogEvent';
import { recordFilterUsed } from '../functions/surfaceEvents';

/**
 * A callback for a filter's change handler that records `filter_used` at most once per mount.
 *
 * Call it from the handler with whether the user's change leaves a query in place — never
 * from an effect on the filter's state, which outlives the view and would count a filter
 * restored on return as a new use. Recording is the whole of the event: the query is never
 * passed in, so it cannot be recorded by mistake.
 */
export default function useRecordFilterUsed(surface: FilterSurface): (hasQuery: boolean) => void {
    const hasRecordedRef = useRef(false);

    return useCallback(
        (hasQuery: boolean) => {
            if (!hasQuery || hasRecordedRef.current) {
                return;
            }

            hasRecordedRef.current = true;
            recordFilterUsed(surface);
        },
        [surface],
    );
}
