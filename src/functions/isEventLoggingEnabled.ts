// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import getServerConfig from './getServerConfig';

/**
 * Whether this install may post events.
 *
 * Kept out of `getServerConfig.ts` deliberately, for the reason `isDirectReportMode.ts`
 * gives: that module is mocked wholesale by a dozen specs, so a predicate living inside it
 * cannot be exercised independently.
 *
 * Checking here is a courtesy rather than a control — the writer re-checks the switch —
 * but it avoids requests when the operator has disabled recording.
 */

let recordingEnabled: boolean | null = null;

export default function isEventLoggingEnabled(): boolean {
    // Memoised: neither the posture nor the switch can change within a page's lifetime,
    // and this is consulted once per recorded event.
    if (recordingEnabled === null) {
        const config = getServerConfig();

        recordingEnabled = !!config.USAGE_RECORDING_ACTIVE;
    }

    return recordingEnabled;
}
