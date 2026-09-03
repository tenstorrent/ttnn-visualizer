// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, HttpStatusCode } from 'axios';
import { describe, expect, it } from 'vitest';
import { NPEValidationError } from '../src/definitions/NPEData';
import { ReportLoadFailureReason } from '../src/definitions/EventLogEvent';
import getNpeReportLoadFailureReason from '../src/functions/getNpeReportLoadFailureReason';

const getAxiosError = (status: number): AxiosError => {
    const error = new AxiosError('private response message');
    error.status = status;
    return error;
};

describe('getNpeReportLoadFailureReason', () => {
    it.each([
        [NPEValidationError.INVALID_NPE_VERSION, ReportLoadFailureReason.UNSUPPORTED_VERSION],
        [NPEValidationError.INVALID_JSON, ReportLoadFailureReason.PARSE_ERROR],
        [NPEValidationError.INVALID_NPE_DATA, ReportLoadFailureReason.PARSE_ERROR],
        [NPEValidationError.EMPTY_NPE_TRACE, ReportLoadFailureReason.OTHER],
        [NPEValidationError.OK, ReportLoadFailureReason.OTHER],
        [NPEValidationError.DEFAULT, ReportLoadFailureReason.OTHER],
    ])('maps validation error %i to %s', (validationError, expected) => {
        expect(getNpeReportLoadFailureReason(validationError)).toBe(expected);
    });

    it('uses the HTTP failure when validation has no more specific reason', () => {
        expect(getNpeReportLoadFailureReason(NPEValidationError.DEFAULT, getAxiosError(HttpStatusCode.NotFound))).toBe(
            ReportLoadFailureReason.MISSING_FILE,
        );
    });

    it('classifies the NPE endpoint 422 contract as a parse error', () => {
        expect(
            getNpeReportLoadFailureReason(
                NPEValidationError.DEFAULT,
                getAxiosError(HttpStatusCode.UnprocessableEntity),
            ),
        ).toBe(ReportLoadFailureReason.PARSE_ERROR);
    });
});
