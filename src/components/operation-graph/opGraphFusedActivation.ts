// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Recovers an activation ttnn fused into a matmul rather than emitting as an op.
 *
 * The role detector reads op names, and that premise holds only while ttnn spells a
 * role as an op. `sentence_bert` fuses every feed-forward GELU into the matmul's
 * `program_config`, so its 12 feed-forward blocks carried no anchor and were dropped
 * as unidentifiable — while `bge_m3`, which emits 24 explicit `ttnn.gelu` ops, was
 * detected fine. Same model family, same role, two spellings.
 *
 * This is the fused/unfused problem one level deeper than attention's: not a different
 * op name, but no op at all. Fusion is the direction of travel, so `bge_m3` is the
 * lucky case rather than the representative one. #1976
 */

/**
 * Matches what the matmul program config actually prints:
 *
 *     fused_activation=UnaryWithParam(op_type=UnaryOpType::GELU, params=[1])
 *
 * Anchored on `UnaryOpType::` rather than on the whole `UnaryWithParam(...)` shape so a
 * future parameter added between them does not silently stop matching.
 */
const FUSED_ACTIVATION = /fused_activation=UnaryWithParam\([^)]*?op_type=UnaryOpType::(\w+)/;

/** The argument that carries it. Nothing else in the payload is read. */
const PROGRAM_CONFIG_ARGUMENT = 'program_config';

export interface FusedActivationSourceArgument {
    name: string;
    value: string;
}

/**
 * The activation's ttnn name, lowercased so it meets the anchor tables on the same
 * footing as an op leaf — `UnaryOpType::GELU` and a `ttnn.gelu` op both arrive as
 * `gelu`, which is what lets one table serve both spellings.
 *
 * `undefined` when the op has no program config, or a config with no fused activation.
 */
export const fusedActivationOf = (
    argumentList: readonly FusedActivationSourceArgument[] | undefined,
): string | undefined => {
    if (argumentList === undefined) {
        return undefined;
    }
    const config = argumentList.find((argument) => argument.name === PROGRAM_CONFIG_ARGUMENT);
    // `?? ''` is not dead despite `value: string`. The column is `value text` with no
    // NOT NULL (`operation_arguments`), and the backend dataclass declares `value: str`
    // without enforcing it — so a null row serialises to JSON `null`, which TS types as
    // a string and a regex would then match against "null". No report sampled has one;
    // the schema permits it. #1976
    const match = config === undefined ? null : FUSED_ACTIVATION.exec(config.value ?? '');
    return match === null ? undefined : match[1].toLowerCase();
};
