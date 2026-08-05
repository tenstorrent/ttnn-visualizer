// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { RemoteConnection } from '../src/definitions/RemoteConnection';
import hasPerformanceDiscoveryChanged from '../src/functions/hasPerformanceDiscoveryChanged';

const connection = (overrides: Partial<RemoteConnection> = {}): RemoteConnection => ({
    name: 'c',
    username: 'u',
    host: 'h',
    port: 22,
    profilerPath: '/remote/generated/ttnn/reports',
    performancePath: '/remote/generated/profiler/reports',
    ...overrides,
});

describe('hasPerformanceDiscoveryChanged', () => {
    it('returns false when nothing relevant changed', () => {
        expect(hasPerformanceDiscoveryChanged(connection(), connection({ name: 'renamed' }))).toBe(false);
    });

    it('returns true when the performance path changed', () => {
        expect(
            hasPerformanceDiscoveryChanged(
                connection(),
                connection({ performancePath: '/remote/generated/profiler/ttrun' }),
            ),
        ).toBe(true);
    });

    it('returns true when the multihost flag is toggled', () => {
        expect(hasPerformanceDiscoveryChanged(connection(), connection({ multihostPerformance: true }))).toBe(true);
        expect(hasPerformanceDiscoveryChanged(connection({ multihostPerformance: true }), connection())).toBe(true);
    });

    it('treats a missing flag as equivalent to false so older saved connections do not churn', () => {
        expect(hasPerformanceDiscoveryChanged(connection(), connection({ multihostPerformance: false }))).toBe(false);
    });

    it('returns false when either connection is missing', () => {
        expect(hasPerformanceDiscoveryChanged(undefined, connection())).toBe(false);
        expect(hasPerformanceDiscoveryChanged(connection(), undefined)).toBe(false);
    });
});
