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

    it.each([DeviceArchitecture.QUASAR, DeviceArchitecture.GRENDEL])(
        'defaults %s to its 32 Tensix cores rather than the Wormhole default',
        (architecture) => {
            expect(resolveMaxCores({ architecture }, [makeRow(8)])).toBe(32);
        },
    );

    // The device log's `ARCH:` token reaches here raw, so casing must not change the default.
    it('normalises the device log arch before looking up its default', () => {
        expect(resolveMaxCores({ architecture: 'QUASAR' as DeviceArchitecture }, [makeRow(8)])).toBe(32);
        expect(resolveMaxCores({ architecture: DeviceArchitecture.GRAYSKULL }, [makeRow(8)])).toBe(108);
    });

    it('honours the rows for an arch it does not recognise', () => {
        expect(resolveMaxCores({ architecture: 'horizon' as DeviceArchitecture }, [makeRow(100)])).toBe(100);
        expect(resolveMaxCores({ architecture: 'horizon' as DeviceArchitecture }, [makeRow(8)])).toBe(
            DEFAULT_MAX_CORES,
        );
    });

    it('falls back to DEFAULT_MAX_CORES when resolved capacity is non-positive', () => {
        expect(resolveMaxCores({ max_cores: 0 }, [])).toBe(DEFAULT_MAX_CORES);
    });
});
