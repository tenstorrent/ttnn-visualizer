// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * MLIR attribute values arrive as strings in the graph JSON — even when they
 * represent arrays, objects, numbers, or booleans (see KeyValueAttr in
 * `MLIRJsonModel.ts`). For rendering we want to distinguish three cases:
 *
 *   1. Scalars (plain strings, numbers, booleans, MLIR pseudo-JSON like
 *      `tensor<4x8xf32>`) — render inline as text.
 *   2. JSON objects — render as an indented key/value tree.
 *   3. JSON arrays — render as an indented index/value tree.
 *
 * This helper is best-effort: if `JSON.parse` rejects the value, or the
 * parsed result is a primitive (string/number/boolean/null), we treat it as a
 * scalar. Only `object` (non-null) and `array` results escalate to nested
 * rendering. Reused by the node details panel (#1547) and by future
 * port-attr rendering (#1548).
 */
export type ParsedAttrValue =
    | { kind: 'scalar'; text: string }
    | { kind: 'object'; parsed: Record<string, unknown> }
    | { kind: 'array'; parsed: unknown[] };

export const tryParseAttrValue = (value: string): ParsedAttrValue => {
    if (value === '') {
        return { kind: 'scalar', text: value };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return { kind: 'scalar', text: value };
    }
    if (Array.isArray(parsed)) {
        return { kind: 'array', parsed };
    }
    if (parsed !== null && typeof parsed === 'object') {
        return { kind: 'object', parsed: parsed as Record<string, unknown> };
    }
    return { kind: 'scalar', text: value };
};
