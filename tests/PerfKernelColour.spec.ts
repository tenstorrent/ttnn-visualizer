// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { getKernelRiscColour } from '../src/functions/perfFunctions';
import { CellColour } from '../src/definitions/CellColour';

describe('getKernelRiscColour', () => {
    it('flags the gating RISC (>= 90% of device kernel duration) as red', () => {
        expect(getKernelRiscColour(95, 100)).toBe(CellColour.Red);
        expect(getKernelRiscColour(100, 100)).toBe(CellColour.Red);
    });

    it('marks a significant contributor (50-90%) as yellow', () => {
        expect(getKernelRiscColour(50, 100)).toBe(CellColour.Yellow);
        expect(getKernelRiscColour(89, 100)).toBe(CellColour.Yellow);
    });

    it('mutes minor contributors (< 50%) to grey', () => {
        expect(getKernelRiscColour(10, 100)).toBe(CellColour.Grey);
        expect(getKernelRiscColour(0, 100)).toBe(CellColour.Grey);
    });

    it('falls back to the default colour when the device kernel duration is missing or zero', () => {
        expect(getKernelRiscColour(50, null)).toBe(CellColour.White);
        expect(getKernelRiscColour(50, 0)).toBe(CellColour.White);
    });
});
