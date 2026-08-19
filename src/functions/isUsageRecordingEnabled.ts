// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import getServerConfig from './getServerConfig';

/**
 * Whether this install may post usage events.
 *
 * Kept out of `getServerConfig.ts` deliberately, for the reason `isDirectReportMode.ts`
 * gives: that module is mocked wholesale by a dozen specs, so a predicate living inside it
 * cannot be exercised independently.
 *
 * Checking here is a courtesy rather than a control — `/api/usage` is `@local_only` and
 * the writer re-checks the switch — but it avoids a request on every interaction in the
 * hosted deployment, where the answer is always no.
 */

let recordingEnabled: boolean | null = null;

export default function isUsageRecordingEnabled(): boolean {
    // Memoised: neither the posture nor the switch can change within a page's lifetime,
    // and this is consulted once per recorded event.
    if (recordingEnabled === null) {
        const config = getServerConfig();

        // Both, not just the flag. The backend already returns false for the hosted
        // posture, so this is belt and braces — but it keeps the client correct if the
        // config is ever served by something that forgets.
        recordingEnabled = !config.SERVER_MODE && !!config.USAGE_RECORDING_ACTIVE;
    }

    return recordingEnabled;
}
