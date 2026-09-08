// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { MLIR_FIT_VIEW_OPTIONS } from '../src/definitions/MlirFitView';

describe('MLIR_FIT_VIEW_OPTIONS', () => {
    it('makes bulk fits instant (initial load + expand/collapse-all)', () => {
        expect(MLIR_FIT_VIEW_OPTIONS.bulk.duration).toBe(0);
        expect(MLIR_FIT_VIEW_OPTIONS.bulk.padding).toBe(0.2);
    });

    it('animates local jumps (recenter / navigate / match-cycling)', () => {
        expect(MLIR_FIT_VIEW_OPTIONS.localJump.duration).toBe(200);
        expect(MLIR_FIT_VIEW_OPTIONS.localJump.padding).toBe(0.3);
    });
});
