// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { IndexedAttr, IndexedPortMetadata } from './mlirGraphTypes';

const MAX_VALUE_CHARS = 40;

const SUPPRESSED_PORT_ATTR_KEYS = new Set(['shape', 'dtype', 'rank', '__tensor_tag']);
// Node-level attrs that actually carry a source-location string. We only
// surface one — first key wins — because they typically all point to the
// same location.
const LOCATION_ATTR_KEYS = ['full_location', 'location', 'loc'];

const stripQuotes = (value: string): string => {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1);
    }
    return value;
};

const compactValue = (value: string): string => {
    const trimmed = stripQuotes(value).replace(/\s+/g, ' ').trim();
    return trimmed.length > MAX_VALUE_CHARS ? `${trimmed.slice(0, MAX_VALUE_CHARS - 1)}…` : trimmed;
};

// Location-only view of the node's attrs (the shape/dtype pieces already
// live on edges + on the shapes toggle, and the rest of the attr set was
// noisy enough not to be worth surfacing in the body).
export function collectLocationLines(attrs: IndexedAttr[]): string[] {
    for (const key of LOCATION_ATTR_KEYS) {
        const hit = attrs.find((attr) => attr.key === key);
        if (hit) {
            const value = compactValue(hit.value);
            if (value.length > 0) {
                return [value];
            }
        }
    }
    return [];
}

const compactPortShape = (port: IndexedPortMetadata): string | null => {
    let shape: string | null = null;
    let dtype: string | null = null;
    for (const attr of port.attrs) {
        if (attr.key === 'shape') {
            shape = attr.value;
        } else if (attr.key === 'dtype') {
            dtype = stripQuotes(attr.value);
        }
    }
    if (shape === null) {
        return null;
    }
    return dtype ? `${shape} ${dtype}` : shape;
};

// One entry per output port. Ports without shape info fall back to a compact
// key=value join of their remaining attrs so the toggle still surfaces
// something meaningful for non-tensor ports.
export function collectShapeLines(ports: IndexedPortMetadata[]): string[] {
    const out: string[] = [];
    for (const port of ports) {
        const compact = compactPortShape(port);
        if (compact) {
            out.push(compact);
        } else {
            const remaining = port.attrs.filter((attr) => !SUPPRESSED_PORT_ATTR_KEYS.has(attr.key));
            if (remaining.length > 0) {
                out.push(remaining.map((attr) => `${attr.key}=${compactValue(attr.value)}`).join(' '));
            }
        }
    }
    return out;
}
