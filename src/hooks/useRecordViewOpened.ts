// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef } from 'react';
import { type Location, useLocation } from 'react-router';
import ROUTES from '../definitions/Routes';
import { isModalOpen, isReturningFromModal } from '../functions/modalRoute';
import { getUsageView, recordViewOpened } from '../functions/viewUsage';

/**
 * Record countable route changes from the one shell shared by every view.
 */
export default function useRecordViewOpened(): void {
    const location = useLocation();
    const previousLocation = useRef<Location | null>(null);

    useEffect(() => {
        const previous = previousLocation.current;
        previousLocation.current = location;

        // React StrictMode repeats effect setup with the same location. Search/hash-only
        // changes likewise do not open a different view.
        if (previous?.pathname === location.pathname) {
            return;
        }

        // Closing topology restores the history entry which remained mounted beneath it;
        // that view was never reopened.
        if (previous && isReturningFromModal(previous, location, ROUTES.CLUSTER)) {
            return;
        }

        // `/cluster` without background state renders no topology overlay, so counting
        // such a deep link would claim a view opened when the user received a blank route.
        if (location.pathname === ROUTES.CLUSTER && !isModalOpen(location, ROUTES.CLUSTER)) {
            return;
        }

        const view = getUsageView(location.pathname);
        if (view !== null) {
            recordViewOpened(view);
        }
    }, [location]);
}
