// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type RefObject, useEffect, useRef } from 'react';
import { type Location, useLocation } from 'react-router';
import { getEventLogView, recordViewEngaged } from '../functions/eventLogViews';
import { getModalBackground, isReturningFromModal } from '../functions/modalRoute';

export const VIEW_ENGAGEMENT_THRESHOLD_MS = 10_000;

interface EngagementState {
    interacted: boolean;
    remainingThresholdMs: number;
    recorded: boolean;
    thresholdReached: boolean;
}

/**
 * Record one engagement after a countable view stays open and receives a deliberate
 * pointer or keyboard interaction. Movement, hover and scroll are excluded because
 * they are high-frequency and can happen without an intentional action.
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
        const continuingSamePath = previousLocation !== null && previousLocation.pathname === location.pathname;
        const engagementByVisitKey = engagementByVisitKeyRef.current;
        if (!returningFromModal && !openingModal && !continuingSamePath) {
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

        let engagementState =
            continuingSamePath && previousLocation !== null
                ? engagementByVisitKey.get(previousLocation.key)
                : engagementByVisitKey.get(location.key);
        if (engagementState === undefined) {
            engagementState = {
                interacted: false,
                remainingThresholdMs: VIEW_ENGAGEMENT_THRESHOLD_MS,
                recorded: false,
                thresholdReached: false,
            };
        }
        if (continuingSamePath && previousLocation !== null) {
            engagementByVisitKey.delete(previousLocation.key);
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
        const handleInteraction = () => {
            engagementState.interacted = true;
            viewContainer.removeEventListener('pointerdown', handleInteraction);
            viewContainer.removeEventListener('keydown', handleInteraction);
            recordIfEngaged();
        };

        if (!engagementState.recorded && !engagementState.thresholdReached) {
            timer = window.setTimeout(() => {
                engagementState.remainingThresholdMs = 0;
                engagementState.thresholdReached = true;
                recordIfEngaged();
            }, engagementState.remainingThresholdMs);
        }
        if (!engagementState.recorded && !engagementState.interacted) {
            viewContainer.addEventListener('pointerdown', handleInteraction);
            viewContainer.addEventListener('keydown', handleInteraction);
        }

        return () => {
            if (!engagementState.thresholdReached) {
                engagementState.remainingThresholdMs = Math.max(
                    0,
                    engagementState.remainingThresholdMs - (Date.now() - activeSince),
                );
            }
            window.clearTimeout(timer);
            viewContainer.removeEventListener('pointerdown', handleInteraction);
            viewContainer.removeEventListener('keydown', handleInteraction);
        };
    }, [location, viewContainerRef]);
}
