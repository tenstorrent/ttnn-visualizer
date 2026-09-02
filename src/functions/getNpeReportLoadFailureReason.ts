// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios, { HttpStatusCode } from 'axios';
import { NPEValidationError, NPE_LOAD_FAILURE_REASON_BY_VALIDATION_ERROR } from '../definitions/NPEData';
import { ReportLoadFailureReason } from '../definitions/UsageEvent';
import { getReportLoadFailureReason } from './reportLoadUsage';

export default function getNpeReportLoadFailureReason(
    validationError: NPEValidationError,
    error: unknown = null,
): ReportLoadFailureReason {
    const validationReason = NPE_LOAD_FAILURE_REASON_BY_VALIDATION_ERROR[validationError];
    if (validationReason !== null) {
        return validationReason;
    }

    if (axios.isAxiosError(error) && (error.status ?? error.response?.status) === HttpStatusCode.UnprocessableEntity) {
        return ReportLoadFailureReason.PARSE_ERROR;
    }

    return getReportLoadFailureReason(error);
}
