// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { isActivatingReportAtom } from '../store/app';

/**
 * Shared lock while a report select/mount awaits confirmation of the active report.
 * Always clears in `finally` so a missed path cannot stick selectors disabled.
 */
export const useActivatingReport = () => {
    const isActivatingReport = useAtomValue(isActivatingReportAtom);
    const setIsActivatingReport = useSetAtom(isActivatingReportAtom);

    const withActivatingReport = useCallback(
        async (action: () => Promise<void>): Promise<void> => {
            setIsActivatingReport(true);

            try {
                await action();
            } finally {
                setIsActivatingReport(false);
            }
        },
        [setIsActivatingReport],
    );

    return { isActivatingReport, withActivatingReport };
};
