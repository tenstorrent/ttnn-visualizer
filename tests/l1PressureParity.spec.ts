// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { computeMostConstrainedL1Device } from '../src/functions/l1Pressure';
import { Buffer, DeviceInfo } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { makeDevice } from './helpers/deviceInfo';
import golden from './data/l1PressureParity.json';

// The agent's Python port (#2172) wrote this golden, from test_agent_l1_pressure_parity.py; holding
// the app to it fails a change on either side. Regenerate with `pnpm run agent:parity-golden`.

interface ParityCase {
    devices: Pick<DeviceInfo, 'device_id' | 'address_at_first_l1_cb_buffer' | 'l1_bank_size' | 'worker_l1_size'>[];
    buffers: Pick<Buffer, 'device_id' | 'address' | 'size'>[];
    expected: {
        device_id: number;
        fullness_pct: number;
        free_segments: number;
        largest_free_block: number;
        largest_free_pct: number;
        allocated_bytes: number;
    };
}

// The agent rounds a percentage to one place.
const PERCENT_PLACE = 0.05 + 1e-9;

const indexedCases = <T>(cases: T[]) => cases.map((entry, index) => [index, entry] as const);

it('the golden holds cases', () => {
    expect(golden.cases.length).toBeGreaterThan(0);
});

describe('computeMostConstrainedL1Device', () => {
    it.each(indexedCases(golden.cases as ParityCase[]))(
        'case %i matches the agent',
        (_, { devices, buffers, expected }) => {
            // The markers bound nothing here: every golden case has a device with geometry.
            const { deviceId, allocatedBytes, metrics } = computeMostConstrainedL1Device(
                buffers.map((buffer) => ({ ...buffer, buffer_type: BufferType.L1 })),
                0,
                0,
                devices.map(makeDevice),
            );

            expect(deviceId).toBe(expected.device_id);
            expect(allocatedBytes).toBe(expected.allocated_bytes);
            expect(metrics.freeSegments).toBe(expected.free_segments);
            expect(metrics.largestFreeBytes).toBe(expected.largest_free_block);
            expect(Math.abs(metrics.fullnessPercent - expected.fullness_pct)).toBeLessThanOrEqual(PERCENT_PLACE);
            expect(Math.abs(metrics.largestFreePercent - expected.largest_free_pct)).toBeLessThanOrEqual(PERCENT_PLACE);
        },
    );
});
