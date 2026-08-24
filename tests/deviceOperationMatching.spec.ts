// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { collapseMultideviceOperations, matchDeviceOperationsToPerf } from '../src/functions/deviceOperationMatching';
import { PerfTableRow } from '../src/model/PerfTable';
import { DeviceOperationMapping } from '../src/model/DeviceOperationMapping';

const mapping = (name: string, id: number): DeviceOperationMapping => ({
    name,
    id,
    operationName: `ttnn.${name.toLowerCase()}`,
});

const perfRow = (rawOpCode: string, id: number): PerfTableRow =>
    ({ id: String(id), raw_op_code: rawOpCode, device_time: '1' }) as unknown as PerfTableRow;

const perfRowsFor = (names: string[]): PerfTableRow[] => names.map((name, index) => perfRow(name, index));

/** Each op recorded once per device, as `numDevices` consecutive entries. */
const duplicatedPerDevice = (names: string[], numDevices: number): DeviceOperationMapping[] =>
    names.flatMap((name, index) => Array.from({ length: numDevices }, () => mapping(name, index + 1)));

describe('matchDeviceOperationsToPerf', () => {
    it('matches a multi-device report that records each device op once (#1810)', () => {
        // Shape of resnet50_jul28_1524: two devices, one entry per device op, and
        // op 5 genuinely repeats `Pad` twice — which the collapse heuristic
        // mistakes for per-device duplication and keeps in isolation.
        const deviceOperations = [
            mapping('PadDeviceOperation', 5),
            mapping('TransposeDeviceOperation', 5),
            mapping('PadDeviceOperation', 5),
            mapping('MatmulDeviceOperation', 6),
        ];
        const perfRows = perfRowsFor([
            'PadDeviceOperation',
            'TransposeDeviceOperation',
            'PadDeviceOperation',
            'MatmulDeviceOperation',
        ]);

        const matched = matchDeviceOperationsToPerf(deviceOperations, perfRows, 2);

        expect(matched).toHaveLength(4);
        expect(matched.map((deviceOperation) => deviceOperation.perfData?.id)).toEqual(['0', '1', '2', '3']);
        // The collapse heuristic alone keeps only the twice-seen `Pad` key, so
        // this report only links via the direct pass.
        expect(collapseMultideviceOperations(deviceOperations, 2)).toHaveLength(1);
    });

    it('falls back to collapsing when the report records each device op once per device', () => {
        const deviceOperations = duplicatedPerDevice(['Alpha', 'Beta', 'Gamma'], 2);
        const perfRows = perfRowsFor(['Alpha', 'Beta', 'Gamma']);

        const matched = matchDeviceOperationsToPerf(deviceOperations, perfRows, 2);

        expect(matched.map(({ name, id }) => [name, id])).toEqual([
            ['Alpha', 1],
            ['Beta', 2],
            ['Gamma', 3],
        ]);
        expect(matched.map((deviceOperation) => deviceOperation.perfData?.id)).toEqual(['0', '1', '2']);
    });

    it('collapses a 32-device report down to the merged perf rows', () => {
        const deviceOperations = duplicatedPerDevice(['Alpha', 'Beta'], 32);

        const matched = matchDeviceOperationsToPerf(deviceOperations, perfRowsFor(['Alpha', 'Beta']), 32);

        expect(matched).toHaveLength(2);
    });

    it('matches when the devices table is empty, which no collapse count can satisfy', () => {
        const deviceOperations = [mapping('Alpha', 1), mapping('Beta', 2)];

        const matched = matchDeviceOperationsToPerf(deviceOperations, perfRowsFor(['Alpha', 'Beta']), 0);

        expect(matched).toHaveLength(2);
    });

    it('matches a single-device report without collapsing repeated ops', () => {
        const deviceOperations = [mapping('Alpha', 1), mapping('Alpha', 1), mapping('Beta', 2)];

        const matched = matchDeviceOperationsToPerf(deviceOperations, perfRowsFor(['Alpha', 'Alpha', 'Beta']), 1);

        expect(matched).toHaveLength(3);
    });

    it('tolerates trailing perf rows the memory report does not describe, such as host ops', () => {
        const matched = matchDeviceOperationsToPerf(
            [mapping('Alpha', 1)],
            perfRowsFor(['Alpha', 'HostOp', 'HostOp']),
            1,
        );

        expect(matched).toHaveLength(1);
        expect(matched[0].perfData?.id).toBe('0');
    });

    it('returns an empty list when the sequences disagree', () => {
        const deviceOperations = [mapping('Alpha', 1), mapping('Beta', 2)];

        expect(matchDeviceOperationsToPerf(deviceOperations, perfRowsFor(['Alpha', 'Gamma']), 1)).toEqual([]);
        expect(matchDeviceOperationsToPerf(deviceOperations, perfRowsFor(['Alpha', 'Gamma']), 2)).toEqual([]);
    });

    it('returns an empty list when the perf report has fewer rows than device operations', () => {
        const deviceOperations = [mapping('Alpha', 1), mapping('Beta', 2), mapping('Gamma', 3)];

        expect(matchDeviceOperationsToPerf(deviceOperations, perfRowsFor(['Alpha', 'Beta']), 1)).toEqual([]);
    });

    it('returns an empty list when there are no device operations', () => {
        expect(matchDeviceOperationsToPerf([], perfRowsFor(['Alpha']), 1)).toEqual([]);
    });

    it('leaves the caller list untouched so a rejected attempt cannot leak perf data', () => {
        const deviceOperations = [mapping('Alpha', 1), mapping('Beta', 2)];

        const matched = matchDeviceOperationsToPerf(deviceOperations, perfRowsFor(['Alpha', 'Beta']), 1);

        expect(deviceOperations.every(({ perfData }) => perfData === undefined)).toBe(true);
        expect(matched[0]).not.toBe(deviceOperations[0]);
    });

    it('does not attach perf data when only part of a multi-device report aligns', () => {
        // The direct pass matches the first two entries before failing; the
        // collapsed fallback then rejects the report outright.
        const deviceOperations = duplicatedPerDevice(['Alpha', 'Beta'], 2);

        const matched = matchDeviceOperationsToPerf(deviceOperations, perfRowsFor(['Alpha', 'Alpha']), 2);

        expect(matched).toEqual([]);
        expect(deviceOperations.every(({ perfData }) => perfData === undefined)).toBe(true);
    });
});

describe('collapseMultideviceOperations', () => {
    it('returns the list unchanged when there is nothing to collapse on', () => {
        const deviceOperations = [mapping('Alpha', 1), mapping('Alpha', 1)];

        expect(collapseMultideviceOperations(deviceOperations, 1)).toBe(deviceOperations);
        expect(collapseMultideviceOperations(deviceOperations, 0)).toBe(deviceOperations);
    });

    it('keeps one entry per key seen exactly once per device and drops the rest', () => {
        const deviceOperations = [
            mapping('Alpha', 1),
            mapping('Alpha', 1),
            // Seen once, so not per-device duplication under this heuristic.
            mapping('Beta', 2),
        ];

        expect(collapseMultideviceOperations(deviceOperations, 2).map(({ name }) => name)).toEqual(['Alpha']);
    });
});
