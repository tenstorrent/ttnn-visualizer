// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { pendingReportLoadsAtom } from '../../src/store/app';
import { PENDING_REPORT_LOADS_PROBE_TEST_ID } from './pendingReportLoads';

/** Renders `pendingReportLoadsAtom`, so a spec can assert which choice awaits its load event. */
export function PendingReportLoadsProbe() {
    const pending = useAtomValue(pendingReportLoadsAtom);

    return <pre data-testid={PENDING_REPORT_LOADS_PROBE_TEST_ID}>{JSON.stringify(pending)}</pre>;
}
