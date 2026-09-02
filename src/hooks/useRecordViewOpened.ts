// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef } from 'react';
import { type Location, useLocation } from 'react-router';
import { isReturningFromModal } from '../functions/modalRoute';
import { getUsageView, recordViewOpened, rememberViewPathname } from '../functions/viewUsage';

/**
 * Record countable route changes from the one shell shared by every view.
 */
export default function useRecordViewOpened(): void {
    const location = useLocation();
    const previousLocation = useRef<Location | null>(null);

    useEffect(() => {
        const previous = previousLocation.current;
        previousLocation.current = location;

        // Module-scope so a ProtectedRoute bounce that remounts Layout cannot re-open the
        // view it lands on. Same-pathname StrictMode and search/hash-only changes share it.
        if (!rememberViewPathname(location.pathname)) {
            return;
        }

        // Closing a modal restores the history entry which remained mounted beneath it;
        // that view was never reopened.
        if (previous && isReturningFromModal(previous, location)) {
            return;
        }

        const view = getUsageView(location);
        if (view !== null) {
            recordViewOpened(view);
        }
    }, [location]);
}
