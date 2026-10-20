// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { getQuantisedNodeZoom } from '../src/components/operation-graph/opGraphNodeZoom';

describe('getQuantisedNodeZoom', () => {
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'falls back to an unscaled 1 for %s',
        (zoom) => {
            // The SCSS divides by it, so anything else here would drop the declaration.
            expect(getQuantisedNodeZoom(zoom)).toBe(1);
        },
    );

    it('gives every zoom in one bucket the same value', () => {
        expect(getQuantisedNodeZoom(1.01)).toBe(getQuantisedNodeZoom(1.03));
    });

    it('moves to another bucket once the zoom has moved far enough', () => {
        expect(getQuantisedNodeZoom(1.5)).not.toBe(getQuantisedNodeZoom(1));
    });

    it('keeps the smallest zoom above zero and close to its true value', () => {
        const quantised = getQuantisedNodeZoom(0.02);

        expect(quantised).toBeGreaterThan(0);
        expect(Math.abs(quantised / 0.02 - 1)).toBeLessThan(0.05);
    });
});
