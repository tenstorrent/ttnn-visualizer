// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { IndexedAttr } from './mlirGraphTypes';
import { ParsedAttrKind, tryParseAttrValue } from './attrFormatter';
import MlirAttrValue from './MlirAttrValue';

/**
 * Renders the attribute block for a single port (used for both the Outputs
 * section's per-port metadata and the Inputs section's producer port
 * metadata). When the port carries a parseable tensor shape + dtype, the
 * common case collapses to a single compact pill (e.g. `[1, 7, 3072] f32`),
 * with any remaining "extra" attrs (e.g. `schedule`, `broadcast_dimensions`)
 * rendered below as a regular key/value list. Falls back to the full
 * key/value rendering when the tensor pieces can't be extracted.
 *
 * Suppressed in the extras list:
 *   - `shape`, `dtype`           — already in the compact pill.
 *   - `rank`                     — redundant with `shape.length`.
 *   - `__tensor_tag`             — names the consumer; useful in the canvas
 *                                  edge label and in the Outputs consumer
 *                                  row, but noisy here.
 */
const SUPPRESSED_ATTR_KEYS = new Set(['shape', 'dtype', 'rank', '__tensor_tag']);

interface MlirPortAttrsProps {
    attrs: IndexedAttr[];
}

const isPrimitive = (value: unknown): value is string | number | boolean | null =>
    value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const formatCompactTensor = (attrs: IndexedAttr[]): string | null => {
    let shape: unknown[] | null = null;
    let dtype: string | null = null;
    for (const attr of attrs) {
        if (attr.key === 'shape') {
            const parsed = tryParseAttrValue(attr.value);
            if (parsed.kind === ParsedAttrKind.Array && parsed.parsed.every(isPrimitive)) {
                shape = parsed.parsed;
            }
        } else if (attr.key === 'dtype') {
            const parsed = tryParseAttrValue(attr.value);
            if (parsed.kind === ParsedAttrKind.Scalar) {
                dtype = parsed.text;
            }
        }
    }
    if (shape === null || dtype === null) {
        return null;
    }
    return `[${shape.map((dim) => String(dim)).join(', ')}] ${dtype}`;
};

const renderAttrList = (attrs: IndexedAttr[]) => (
    <dl className='mlir-node-details-attrs mlir-node-details-port-attrs'>
        {attrs.map((attr) => (
            <div
                className='mlir-node-details-attr-row'
                key={attr.key}
            >
                <dt className='mlir-node-details-attr-key'>{attr.key}</dt>
                <dd className='mlir-node-details-attr-value'>
                    <MlirAttrValue value={attr.value} />
                </dd>
            </div>
        ))}
    </dl>
);

const MlirPortAttrs = ({ attrs }: MlirPortAttrsProps) => {
    if (attrs.length === 0) {
        return null;
    }
    const compact = formatCompactTensor(attrs);
    if (compact === null) {
        return renderAttrList(attrs);
    }
    const extras = attrs.filter((attr) => !SUPPRESSED_ATTR_KEYS.has(attr.key));
    return (
        <div className='mlir-port-attrs'>
            <div className='mlir-port-attrs-compact'>{compact}</div>
            {extras.length > 0 && renderAttrList(extras)}
        </div>
    );
};

export default MlirPortAttrs;
