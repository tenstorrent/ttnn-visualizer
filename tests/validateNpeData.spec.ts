// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { NPEValidationError } from '../src/definitions/NPEData';
import { validateNpeData } from '../src/functions/validateNpeData';
import { minimalValidNpeData } from './helpers/npeFixtures';

describe('validateNpeData', () => {
    it('returns OK for a well-formed payload', () => {
        expect(validateNpeData(minimalValidNpeData)).toBe(NPEValidationError.OK);
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
                ...minimalValidNpeData,
                noc_transfers: [],
            }),
        ).toBe(NPEValidationError.EMPTY_NPE_TRACE);
    });

    it('returns EMPTY_NPE_TRACE when timestep_data is empty', () => {
        expect(
            validateNpeData({
                ...minimalValidNpeData,
                timestep_data: [],
            }),
        ).toBe(NPEValidationError.EMPTY_NPE_TRACE);
    });

    it('returns EMPTY_NPE_TRACE when both transfer arrays are empty', () => {
        expect(
            validateNpeData({
                ...minimalValidNpeData,
                noc_transfers: [],
                timestep_data: [],
            }),
        ).toBe(NPEValidationError.EMPTY_NPE_TRACE);
    });

    it('returns INVALID_NPE_VERSION when version is missing', () => {
        expect(
            validateNpeData({
                ...minimalValidNpeData,
                common_info: {},
            }),
        ).toBe(NPEValidationError.INVALID_NPE_VERSION);
    });

    it('returns INVALID_NPE_VERSION when major version does not match', () => {
        expect(
            validateNpeData({
                ...minimalValidNpeData,
                common_info: { version: '0.5.0' },
            }),
        ).toBe(NPEValidationError.INVALID_NPE_VERSION);
    });
});
