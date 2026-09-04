// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { fusedActivationOf } from '../src/components/operation-graph/opGraphFusedActivation';

/**
 * The real `program_config` from `sentence_bert` operation 297 — the intermediate
 * matmul of one feed-forward block. Verbatim rather than trimmed, because the parser's
 * whole job is surviving this string's actual shape.
 */
const REAL_PROGRAM_CONFIG =
    'MatmulMultiCoreReuseMultiCastProgramConfig(compute_with_storage_grid_size=6-8,in0_block_w=4,' +
    'out_subblock_h=1,out_subblock_w=8,out_block_h=12,out_block_w=16,per_core_M=12,per_core_N=16,' +
    'transpose_mcast=0,fused_activation=UnaryWithParam(op_type=UnaryOpType::GELU, params=[1]),' +
    'fuse_batch=1,allowed_worker_cores=std::nullopt)';

const argument = (name: string, value: string) => ({ name, value });

describe('fusedActivationOf', () => {
    it('reads the activation out of a real matmul program config', () => {
        expect(fusedActivationOf([argument('program_config', REAL_PROGRAM_CONFIG)])).toBe('gelu');
    });

    it('lowercases the ttnn enum so it meets the anchor tables as an op leaf would', () => {
        // `UnaryOpType::SILU` and a `ttnn.silu` op must both arrive as `silu`, which is
        // what lets one anchor table serve the fused and unfused spellings.
        expect(
            fusedActivationOf([
                argument('program_config', 'Cfg(fused_activation=UnaryWithParam(op_type=UnaryOpType::SILU))'),
            ]),
        ).toBe('silu');
    });

    it('reads only the program config, not any other argument that mentions one', () => {
        // Arguments carry whole serialised tensors and memory configs; matching on value
        // alone across every argument would be a much larger and less predictable scan.
        expect(
            fusedActivationOf([
                argument('memory_config', 'fused_activation=UnaryWithParam(op_type=UnaryOpType::RELU)'),
            ]),
        ).toBeUndefined();
    });

    it('tolerates a parameter appearing between the wrapper and the op type', () => {
        // Anchored on `UnaryOpType::` rather than the exact `UnaryWithParam(op_type=`
        // sequence, so a field added ahead of it does not silently stop matching.
        expect(
            fusedActivationOf([
                argument('program_config', 'Cfg(fused_activation=UnaryWithParam(scale=2, op_type=UnaryOpType::GELU))'),
            ]),
        ).toBe('gelu');
    });

    it('returns nothing for a program config without a fused activation', () => {
        expect(fusedActivationOf([argument('program_config', 'MatmulProgramConfig(in0_block_w=4)')])).toBeUndefined();
    });

    it('returns nothing when the op has no arguments at all', () => {
        expect(fusedActivationOf(undefined)).toBeUndefined();
        expect(fusedActivationOf([])).toBeUndefined();
    });
});
