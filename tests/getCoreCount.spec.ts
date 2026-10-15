// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { OpType } from '../src/definitions/Performance';
import getCoreCount, { DEFAULT_MAX_CORES, resolveMaxCores } from '../src/functions/getCoreCount';

const makeRow = (cores: number): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        cores,
    }) as TypedPerfTableRow;

describe('resolveMaxCores', () => {
    it('uses device meta max_cores when provided', () => {
        expect(resolveMaxCores({ max_cores: 130 }, [makeRow(8)])).toBe(130);
    });

    it('falls back to architecture default when rows are below device max', () => {
        expect(resolveMaxCores(null, [makeRow(48)])).toBe(DEFAULT_MAX_CORES);
    });

    it('uses row core count when it exceeds architecture default', () => {
        expect(resolveMaxCores(null, [makeRow(100)])).toBe(100);
    });

    it('uses architecture from device meta when max_cores is absent', () => {
        expect(resolveMaxCores({ architecture: DeviceArchitecture.BLACKHOLE }, [makeRow(8)])).toBe(
            getCoreCount(DeviceArchitecture.BLACKHOLE, [makeRow(8)]),
        );
    });

    it('defaults Quasar to its 32 Tensix cores rather than the Wormhole default', () => {
        expect(resolveMaxCores({ architecture: DeviceArchitecture.QUASAR }, [makeRow(8)])).toBe(32);
    });

    it("prefers the device log's core count for a Quasar run with Tensix dispatch", () => {
        // Dispatch on Tensix reserves a column of the 8x4 grid, leaving 28 compute cores.
        expect(resolveMaxCores({ architecture: DeviceArchitecture.QUASAR, max_cores: 28 }, [makeRow(8)])).toBe(28);
    });

    it('falls back to DEFAULT_MAX_CORES when resolved capacity is non-positive', () => {
        expect(resolveMaxCores({ max_cores: 0 }, [])).toBe(DEFAULT_MAX_CORES);
    });
});
