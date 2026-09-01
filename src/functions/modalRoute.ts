// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Location } from 'react-router';

interface ModalLocationState {
    background?: Location;
}

export function getModalBackground(location: Location): Location | null {
    const state = location.state as ModalLocationState | null;
    return state?.background ?? null;
}

export function isModalOpen(location: Location, modalPath: string): boolean {
    return location.pathname === modalPath && getModalBackground(location) !== null;
}

export function isReturningFromModal(previous: Location, current: Location, modalPath: string): boolean {
    const background = getModalBackground(previous);

    // The key identifies the exact history entry behind the modal. Comparing only
    // pathnames would also suppress a real navigation to the same path with different
    // search parameters or state.
    return previous.pathname === modalPath && background?.key === current.key;
}
