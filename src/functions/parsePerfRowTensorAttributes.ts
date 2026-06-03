// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfTableRow } from '../definitions/PerfTable';
import { DeviceOperationLayoutTypes } from '../model/APIData';
import { BufferType } from '../model/BufferType';

const DEV_MEMORY_REGEX = /DEV_(\d+)_(DRAM|L1)_(\w*)/m;

const KNOWN_LAYOUTS = new Set<string>(Object.values(DeviceOperationLayoutTypes));

export interface ParsedPerfRowAttributes {
    buffer_type: BufferType | null;
    layout: DeviceOperationLayoutTypes | null;
}

const getBufferType = (type?: string): BufferType | null => {
    if (!type) {
        return null;
    }

    if (type === 'L1') {
        return BufferType.L1;
    }

    if (type === 'DRAM') {
        return BufferType.DRAM;
    }

    return null;
};

const getLayout = (layout?: string): DeviceOperationLayoutTypes | null =>
    layout && KNOWN_LAYOUTS.has(layout) ? (layout as DeviceOperationLayoutTypes) : null;

export const parsePerfRowTensorAttributes = (row: Pick<PerfTableRow, 'input_0_memory'>): ParsedPerfRowAttributes => {
    const match = DEV_MEMORY_REGEX.exec(row.input_0_memory);

    return {
        buffer_type: getBufferType(match?.[2]),
        layout: getLayout(match?.[3]),
    };
};
