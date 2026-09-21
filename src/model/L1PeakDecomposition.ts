// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { L1PeakDecompositionResult } from '../functions/l1PeakDecomposition';

/**
 * Mirrors `L1PressureStatus`: the component has to tell "still fetching", "no report",
 * "the fetch failed" and "this report genuinely has no L1" apart, and a bare empty result
 * makes all four look like the last one.
 */
export enum L1PeakStatus {
    Unavailable = 'unavailable',
    Loading = 'loading',
    Error = 'error',
    Ready = 'ready',
}

export interface L1PeakDecompositionState {
    status: L1PeakStatus;
    data: L1PeakDecompositionResult | null;
    /**
     * Addresses hosting more than one tensor lifetime, where staleness cannot be attributed
     * to the tensor actually resident. Those addresses are left unclassified, so the stale
     * figure is a floor and the UI has to say so. #2029
     */
    unattributableStaleAddressCount: number;
}
