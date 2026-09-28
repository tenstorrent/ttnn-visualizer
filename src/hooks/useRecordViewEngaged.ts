// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type RefObject, useEffect, useRef } from 'react';
import { type Location, useLocation } from 'react-router';
import { VIEW_ENGAGEMENT_THRESHOLD_MS } from '../definitions/ViewEngagement';
import { getEventLogView, recordViewEngaged } from '../functions/eventLogViews';
import { getModalBackground, isReturningFromModal } from '../functions/modalRoute';

// One list for attaching and detaching, so an interaction added to one cannot be missed
// by the other.
const INTERACTION_EVENTS = ['pointerdown', 'keydown'] as const;

interface EngagementState {
    interacted: boolean;
    remainingThresholdMs: number;
    recorded: boolean;
    thresholdReached: boolean;
}

const createEngagementState = (): EngagementState => ({
    interacted: false,
    remainingThresholdMs: VIEW_ENGAGEMENT_THRESHOLD_MS,
    recorded: false,
    thresholdReached: false,
});

/**
 * Record one engagement after a countable view stays open and receives a deliberate
 * pointer or keyboard interaction. Movement, hover and scroll are excluded because
 * they are high-frequency and can happen without an intentional action.
 *
 * Listeners sit on the view container, so drawers, dialogs and popovers that portal to
 * `document.body` do not count; opening one from the view already has.
 */
export default function useRecordViewEngaged(viewContainerRef: RefObject<HTMLElement | null>): void {
    const location = useLocation();
    const previousLocationRef = useRef<Location | null>(null);
    const engagementByVisitKeyRef = useRef<Map<string, EngagementState>>(new Map());

    useEffect(() => {
        const viewContainer = viewContainerRef.current;
        if (viewContainer === null) {
            return undefined;
        }

        const previousLocation = previousLocationRef.current;
        const returningFromModal = previousLocation !== null && isReturningFromModal(previousLocation, location);
        const openingModal = previousLocation !== null && getModalBackground(location)?.key === previousLocation.key;
        const continuedFrom =
            previousLocation !== null && previousLocation.pathname === location.pathname ? previousLocation : null;
        const engagementByVisitKey = engagementByVisitKeyRef.current;
        if (!returningFromModal && !openingModal && continuedFrom === null) {
            engagementByVisitKey.clear();
        }
        if (returningFromModal && previousLocation !== null) {
            engagementByVisitKey.delete(previousLocation.key);
        }
        previousLocationRef.current = location;

        const view = getEventLogView(location);
        if (view === null) {
            engagementByVisitKey.clear();
            return undefined;
        }

        const engagementState = engagementByVisitKey.get((continuedFrom ?? location).key) ?? createEngagementState();
        if (continuedFrom !== null) {
            engagementByVisitKey.delete(continuedFrom.key);
        }
        engagementByVisitKey.set(location.key, engagementState);

        let timer = 0;
        const activeSince = Date.now();

        const recordIfEngaged = () => {
            if (!engagementState.recorded && engagementState.thresholdReached && engagementState.interacted) {
                engagementState.recorded = true;
                window.clearTimeout(timer);
                recordViewEngaged(view);
            }
        };
        const detachInteractionListeners = () => {
            INTERACTION_EVENTS.forEach((eventName) => viewContainer.removeEventListener(eventName, handleInteraction));
        };
        function handleInteraction() {
            engagementState.interacted = true;
            detachInteractionListeners();
            recordIfEngaged();
        }

        if (!engagementState.recorded && !engagementState.thresholdReached) {
            timer = window.setTimeout(() => {
                engagementState.remainingThresholdMs = 0;
                engagementState.thresholdReached = true;
                recordIfEngaged();
            }, engagementState.remainingThresholdMs);
        }
        if (!engagementState.recorded && !engagementState.interacted) {
            INTERACTION_EVENTS.forEach((eventName) => viewContainer.addEventListener(eventName, handleInteraction));
        }

        return () => {
            if (!engagementState.thresholdReached) {
                engagementState.remainingThresholdMs = Math.max(
                    0,
                    engagementState.remainingThresholdMs - (Date.now() - activeSince),
                );
            }
            window.clearTimeout(timer);
            detachInteractionListeners();
        };
    }, [location, viewContainerRef]);
}
