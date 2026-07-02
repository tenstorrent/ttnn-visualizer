// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { getKernelRiscColour } from '../src/functions/perfFunctions';
import { CellColour } from '../src/definitions/CellColour';

describe('getKernelRiscColour', () => {
    it('accents the critical-path RISC (>= 90% of device kernel duration)', () => {
        expect(getKernelRiscColour(95, 100)).toBe(CellColour.Blue);
        expect(getKernelRiscColour(100, 100)).toBe(CellColour.Blue);
    });

    // Non-critical RISCs keep the default (readable) colour rather than being dimmed, so a near-miss
    // RISC stays legible — only the gating RISC is accented.
    it('leaves RISCs below the critical-path threshold at the default colour', () => {
        expect(getKernelRiscColour(89, 100)).toBe(CellColour.White);
        expect(getKernelRiscColour(50, 100)).toBe(CellColour.White);
        expect(getKernelRiscColour(0, 100)).toBe(CellColour.White);
    });

    it('falls back to the default colour when the device kernel duration is missing or zero', () => {
        expect(getKernelRiscColour(50, null)).toBe(CellColour.White);
        expect(getKernelRiscColour(50, 0)).toBe(CellColour.White);
    });
});
