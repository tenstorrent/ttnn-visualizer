// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import MlirPortAttrs from '../src/components/mlir/MlirPortAttrs';
import type { IndexedAttr } from '../src/components/mlir/mlirGraphTypes';

afterEach(cleanup);

const shapeDtype: IndexedAttr[] = [
    { key: 'shape', value: '[1, 7, 3072]' },
    { key: 'dtype', value: 'f32' },
];

describe('MlirPortAttrs', () => {
    it('renders nothing when attrs is empty', () => {
        const { container } = render(<MlirPortAttrs attrs={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the compact `[shape] dtype` pill for a standard tensor port', () => {
        const { container } = render(<MlirPortAttrs attrs={shapeDtype} />);
        const pill = container.querySelector('.mlir-port-attrs-compact');
        expect(pill).not.toBeNull();
        expect(pill?.textContent).toBe('[1, 7, 3072] f32');
        // No extras → no key/value list at all.
        expect(container.querySelector('.mlir-node-details-port-attrs')).toBeNull();
    });

    it('suppresses `rank` and `__tensor_tag` from the extras list when the compact pill is shown', () => {
        const attrs: IndexedAttr[] = [
            ...shapeDtype,
            { key: 'rank', value: '3' },
            { key: '__tensor_tag', value: '%result_7' },
        ];
        const { container } = render(<MlirPortAttrs attrs={attrs} />);
        expect(container.querySelector('.mlir-port-attrs-compact')).not.toBeNull();
        expect(screen.queryByText('rank')).toBeNull();
        expect(screen.queryByText('__tensor_tag')).toBeNull();
        // Pill is the only block in the DOM apart from the wrapper.
        expect(container.querySelector('.mlir-node-details-port-attrs')).toBeNull();
    });

    it('renders extras (e.g. `schedule`, `broadcast_dimensions`) below the compact pill', () => {
        const attrs: IndexedAttr[] = [
            ...shapeDtype,
            { key: 'schedule', value: '12' },
            { key: 'broadcast_dimensions', value: '[0, 2]' },
        ];
        const { container } = render(<MlirPortAttrs attrs={attrs} />);
        expect(container.querySelector('.mlir-port-attrs-compact')).not.toBeNull();
        const extras = container.querySelector('.mlir-node-details-port-attrs');
        expect(extras).not.toBeNull();
        // Both extra keys land in the list; shape/dtype don't.
        expect(screen.getByText('schedule')).toBeInTheDocument();
        expect(screen.getByText('broadcast_dimensions')).toBeInTheDocument();
        expect(screen.queryByText('shape')).toBeNull();
        expect(screen.queryByText('dtype')).toBeNull();
    });

    it('falls back to the full key/value list when `shape` is not a JSON array of primitives', () => {
        // Real adapters occasionally emit `shape` as the MLIR tensor type
        // string (e.g. `tensor<4x8xf32>`) which `tryParseAttrValue` treats
        // as a scalar. The compact pill can't form, so we should fall back
        // to showing every attr verbatim.
        const attrs: IndexedAttr[] = [
            { key: 'shape', value: 'tensor<4x8xf32>' },
            { key: 'dtype', value: 'f32' },
        ];
        const { container } = render(<MlirPortAttrs attrs={attrs} />);
        expect(container.querySelector('.mlir-port-attrs-compact')).toBeNull();
        expect(screen.getByText('shape')).toBeInTheDocument();
        expect(screen.getByText('dtype')).toBeInTheDocument();
    });

    it('falls back to the full key/value list when `dtype` is missing', () => {
        const attrs: IndexedAttr[] = [
            { key: 'shape', value: '[4, 8]' },
            { key: 'schedule', value: '12' },
        ];
        const { container } = render(<MlirPortAttrs attrs={attrs} />);
        expect(container.querySelector('.mlir-port-attrs-compact')).toBeNull();
        expect(screen.getByText('shape')).toBeInTheDocument();
        expect(screen.getByText('schedule')).toBeInTheDocument();
    });
});
