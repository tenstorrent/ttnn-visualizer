// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import useReportLoadSettlement from '../hooks/useReportLoadSettlement';

/**
 * Renders nothing; exists so `useReportLoadSettlement` has an always-mounted host other
 * than `Layout`. Its query and atom subscriptions re-render whichever component calls
 * it, and called from `Layout` that would be the whole route tree on every report load.
 */
const ReportLoadRecorder = () => {
    useReportLoadSettlement();

    return null;
};

export default ReportLoadRecorder;
