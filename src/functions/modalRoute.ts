// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Location } from 'react-router';
import { NAVIGATION_ITEMS } from '../definitions/NavigationItems';

export interface ModalLocationState {
    background?: Location;
}

export const MODAL_ROUTES: readonly string[] = Object.freeze(
    NAVIGATION_ITEMS.filter((item) => item.isModal).map((item) => item.route),
);

export function getModalBackground(location: Pick<Location, 'state'>): Location | null {
    const state = location.state as ModalLocationState | null;
    return state?.background ?? null;
}

export function isModalOpen(location: Pick<Location, 'pathname' | 'state'>, modalPath: string): boolean {
    return location.pathname === modalPath && getModalBackground(location) !== null;
}

export function isReturningFromModal(previous: Location, current: Location): boolean {
    const background = getModalBackground(previous);

    // The key identifies the exact history entry behind the modal. Comparing only
    // pathnames would also suppress a real navigation to the same path with different
    // search parameters or state.
    return MODAL_ROUTES.includes(previous.pathname) && background?.key === current.key;
}

export function modalNavigationState(location: Location): { state: ModalLocationState } {
    return { state: { background: location } };
}
