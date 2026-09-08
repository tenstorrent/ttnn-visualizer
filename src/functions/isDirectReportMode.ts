// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import getServerConfig from './getServerConfig';

/**
 * Whether the app is reading reports straight out of a TT-Metal checkout.
 *
 * One home for the whole rule — `TT_METAL_HOME` present means no upload, no remote sync, no
 * delete, because the app neither created those reports nor manages them. Gates read this
 * rather than re-deriving the condition, so a new one can't land on some of the three.
 *
 * Kept out of `getServerConfig.ts` deliberately: that module is mocked wholesale by a dozen
 * specs, and a predicate living there would have to be re-stated inside every such mock —
 * re-deriving the rule in test code instead of in components. Here it composes with whatever
 * config a spec has already mocked.
 */
export default function isDirectReportMode(): boolean {
    return !!getServerConfig()?.TT_METAL_HOME;
}
