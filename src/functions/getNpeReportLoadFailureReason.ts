// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NPEValidationError, NPE_LOAD_FAILURE_REASON_BY_VALIDATION_ERROR } from '../definitions/NPEData';
import { ReportLoadFailureReason } from '../definitions/EventLogEvent';
import { getParsedReportLoadFailureReason } from './reportLoadEvents';

export default function getNpeReportLoadFailureReason(
    validationError: NPEValidationError,
    error: unknown = null,
): ReportLoadFailureReason {
    const validationReason = NPE_LOAD_FAILURE_REASON_BY_VALIDATION_ERROR[validationError];
    if (validationReason !== null) {
        return validationReason;
    }

    return getParsedReportLoadFailureReason(error);
}
