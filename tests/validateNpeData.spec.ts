// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { NPEValidationError, validateNpeData } from '../src/definitions/NPEData';

const validData = {
    common_info: { version: '1.0.0' },
    noc_transfers: [{ id: 0 }],
    timestep_data: [{ active_transfers: [] }],
};

describe('validateNpeData', () => {
    it('returns OK for a well-formed payload', () => {
        expect(validateNpeData(validData)).toBe(NPEValidationError.OK);
    });

    it('returns INVALID_NPE_DATA for non-object input', () => {
        expect(validateNpeData(null)).toBe(NPEValidationError.INVALID_NPE_DATA);
        expect(validateNpeData('not-an-object')).toBe(NPEValidationError.INVALID_NPE_DATA);
    });

    it('returns INVALID_NPE_DATA when required top-level keys are missing', () => {
        expect(validateNpeData({ common_info: { version: '1.0.0' } })).toBe(NPEValidationError.INVALID_NPE_DATA);
    });

    it('returns EMPTY_NPE_TRACE when noc_transfers is empty', () => {
        expect(
            validateNpeData({
                ...validData,
                noc_transfers: [],
            }),
        ).toBe(NPEValidationError.EMPTY_NPE_TRACE);
    });

    it('returns EMPTY_NPE_TRACE when timestep_data is empty', () => {
        expect(
            validateNpeData({
                ...validData,
                timestep_data: [],
            }),
        ).toBe(NPEValidationError.EMPTY_NPE_TRACE);
    });

    it('returns EMPTY_NPE_TRACE when both transfer arrays are empty', () => {
        expect(
            validateNpeData({
                ...validData,
                noc_transfers: [],
                timestep_data: [],
            }),
        ).toBe(NPEValidationError.EMPTY_NPE_TRACE);
    });

    it('returns INVALID_NPE_VERSION when version is missing', () => {
        expect(
            validateNpeData({
                ...validData,
                common_info: {},
            }),
        ).toBe(NPEValidationError.INVALID_NPE_VERSION);
    });

    it('returns INVALID_NPE_VERSION when major version does not match', () => {
        expect(
            validateNpeData({
                ...validData,
                common_info: { version: '0.5.0' },
            }),
        ).toBe(NPEValidationError.INVALID_NPE_VERSION);
    });
});
