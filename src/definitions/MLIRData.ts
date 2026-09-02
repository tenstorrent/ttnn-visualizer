// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ReportLoadFailureReason } from './UsageEvent';

export enum MLIRValidationError {
    OK,
    DEFAULT,
    INVALID_JSON,
}

export const MLIR_LOAD_FAILURE_REASON_BY_VALIDATION_ERROR: Record<MLIRValidationError, ReportLoadFailureReason> = {
    [MLIRValidationError.OK]: ReportLoadFailureReason.OTHER,
    [MLIRValidationError.DEFAULT]: ReportLoadFailureReason.OTHER,
    [MLIRValidationError.INVALID_JSON]: ReportLoadFailureReason.PARSE_ERROR,
};
