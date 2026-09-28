// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { getEventLogView, recordViewEngaged } from '../functions/eventLogViews';

export const VIEW_ENGAGEMENT_THRESHOLD_MS = 10_000;

/**
 * Record one engagement after a countable view stays open and receives a deliberate
 * pointer or keyboard interaction. Movement, hover and scroll are excluded because
 * they are high-frequency and can happen without an intentional action.
 */
export default function useRecordViewEngaged(): void {
    const { pathname, state } = useLocation();

    useEffect(() => {
        const view = getEventLogView({ pathname, state });
        if (view === null) {
            return undefined;
        }

        let thresholdReached = false;
        let interacted = false;
        let recorded = false;
        let timer = 0;

        const recordIfEngaged = () => {
            if (!recorded && thresholdReached && interacted) {
                recorded = true;
                window.clearTimeout(timer);
                recordViewEngaged(view);
            }
        };
        const handleInteraction = () => {
            interacted = true;
            document.removeEventListener('pointerdown', handleInteraction);
            document.removeEventListener('keydown', handleInteraction);
            recordIfEngaged();
        };
        timer = window.setTimeout(() => {
            thresholdReached = true;
            recordIfEngaged();
        }, VIEW_ENGAGEMENT_THRESHOLD_MS);

        document.addEventListener('pointerdown', handleInteraction);
        document.addEventListener('keydown', handleInteraction);

        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('pointerdown', handleInteraction);
            document.removeEventListener('keydown', handleInteraction);
        };
    }, [pathname, state]);
}
