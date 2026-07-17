// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import useRecordReportLink from '../hooks/useRecordReportLink';

/** Mount only when both reports are active so match queries are not fetched on first select. */
const ReportLinkRecorder = () => {
    useRecordReportLink();
    return null;
};

export default ReportLinkRecorder;
