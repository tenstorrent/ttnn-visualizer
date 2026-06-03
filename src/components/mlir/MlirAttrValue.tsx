// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ParsedAttrKind, tryParseAttrValue } from './attrFormatter';

interface MlirAttrValueProps {
    value: string;
}

const renderPrimitive = (v: unknown): string => {
    if (v === null) {
        return 'null';
    }
    if (typeof v === 'string') {
        return v;
    }
    return String(v);
};

interface NestedTreeProps {
    data: unknown;
}

// Recursive walker for parsed JSON. Renders objects as `key: value` rows and
// arrays as `[i]: value` rows. Nested objects/arrays produce further indented
// children. Primitives are rendered as text. The component is intentionally
// styleless beyond two class hooks (`.mlir-attr-tree`, `.mlir-attr-row`) — the
// panel SCSS owns all visual details.
const NestedTree = ({ data }: NestedTreeProps) => {
    if (Array.isArray(data)) {
        if (data.length === 0) {
            return <span className='mlir-attr-empty'>[]</span>;
        }
        return (
            <ul className='mlir-attr-tree'>
                {data.map((item, idx) => (
                    <li
                        key={idx}
                        className='mlir-attr-row'
                    >
                        <span className='mlir-attr-key'>[{idx}]</span>
                        {Array.isArray(item) || (item !== null && typeof item === 'object') ? (
                            <NestedTree data={item} />
                        ) : (
                            <span className='mlir-attr-value'>{renderPrimitive(item)}</span>
                        )}
                    </li>
                ))}
            </ul>
        );
    }
    if (data !== null && typeof data === 'object') {
        const entries = Object.entries(data as Record<string, unknown>);
        if (entries.length === 0) {
            return <span className='mlir-attr-empty'>{'{}'}</span>;
        }
        return (
            <ul className='mlir-attr-tree'>
                {entries.map(([k, v]) => (
                    <li
                        key={k}
                        className='mlir-attr-row'
                    >
                        <span className='mlir-attr-key'>{k}</span>
                        {Array.isArray(v) || (v !== null && typeof v === 'object') ? (
                            <NestedTree data={v} />
                        ) : (
                            <span className='mlir-attr-value'>{renderPrimitive(v)}</span>
                        )}
                    </li>
                ))}
            </ul>
        );
    }
    return <span className='mlir-attr-value'>{renderPrimitive(data)}</span>;
};

const MlirAttrValue = ({ value }: MlirAttrValueProps) => {
    const parsed = tryParseAttrValue(value);
    if (parsed.kind === ParsedAttrKind.Scalar) {
        return <span className='mlir-attr-value mlir-attr-value-scalar'>{parsed.text}</span>;
    }
    return <NestedTree data={parsed.parsed} />;
};

export default MlirAttrValue;
