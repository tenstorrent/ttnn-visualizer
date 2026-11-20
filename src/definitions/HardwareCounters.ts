// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// The enums mirror `backend/ttnn_visualizer/hardware_counters.py`; a backend parity test holds them.
export enum HardwareCounterUnit {
    FPU = 'fpu',
    SFPU = 'sfpu',
    MATH = 'math',
    PACKER = 'packer',
    UNPACKER0 = 'unpacker0',
    UNPACKER1 = 'unpacker1',
    L1_BANDWIDTH = 'l1_bandwidth',
    NOC_RING0 = 'noc_ring0',
    NOC_RING1 = 'noc_ring1',
}

export enum HardwareCounterFamily {
    COMPUTE = 'compute',
    UNPACK = 'unpack',
    PACK = 'pack',
    L1_PORTS = 'l1_ports',
    NOC_RING = 'noc_ring',
    INSTRUCTION_ISSUE = 'instruction_issue',
    STALLS = 'stalls',
    OTHER = 'other',
}

export enum HardwareCounterAbsence {
    NOT_CAPTURED = 'not_captured',
    NOT_ON_ARCHITECTURE = 'not_on_architecture',
    NO_VALUE = 'no_value',
}

export enum HardwareCounterMeasure {
    PERCENT = 'percent',
    RATIO = 'ratio',
}

export const HARDWARE_COUNTER_CAPTURE_FLAG = '--profiler-capture-perf-counters';
// tt-metal's one-pass example: at most one L1 group fits a pass.
export const HARDWARE_COUNTER_EXAMPLE_GROUPS = 'fpu,pack,unpack,instrn,l1_0';

export const HARDWARE_COUNTER_UNIT_LABELS: Record<HardwareCounterUnit, string> = {
    [HardwareCounterUnit.FPU]: 'FPU',
    [HardwareCounterUnit.SFPU]: 'SFPU',
    [HardwareCounterUnit.MATH]: 'MATH',
    [HardwareCounterUnit.PACKER]: 'Packer',
    [HardwareCounterUnit.UNPACKER0]: 'Unpacker 0',
    [HardwareCounterUnit.UNPACKER1]: 'Unpacker 1',
    [HardwareCounterUnit.L1_BANDWIDTH]: 'L1 bandwidth',
    [HardwareCounterUnit.NOC_RING0]: 'NoC ring 0',
    [HardwareCounterUnit.NOC_RING1]: 'NoC ring 1',
};

export const HARDWARE_COUNTER_FAMILY_LABELS: Record<HardwareCounterFamily, string> = {
    [HardwareCounterFamily.COMPUTE]: 'Compute',
    [HardwareCounterFamily.UNPACK]: 'Unpack',
    [HardwareCounterFamily.PACK]: 'Pack',
    [HardwareCounterFamily.L1_PORTS]: 'L1 ports',
    [HardwareCounterFamily.NOC_RING]: 'NoC ring',
    [HardwareCounterFamily.INSTRUCTION_ISSUE]: 'Thread and instruction issue',
    [HardwareCounterFamily.STALLS]: 'Stalls',
    [HardwareCounterFamily.OTHER]: 'Other',
};

export const HARDWARE_COUNTER_ABSENCE_LABELS: Record<HardwareCounterAbsence, string> = {
    [HardwareCounterAbsence.NOT_CAPTURED]: 'not captured',
    [HardwareCounterAbsence.NOT_ON_ARCHITECTURE]: 'N/A on this architecture',
    [HardwareCounterAbsence.NO_VALUE]: 'no value for this operation',
};

export const HARDWARE_COUNTERS_SWITCH_LABEL = 'Hardware counters';
export const HARDWARE_COUNTERS_SWITCH_HINT =
    "Each unit's average utilization across an operation's cores, from tt-metal's hardware counters";
export const NO_HARDWARE_COUNTERS_HINT = `This report has no hardware counter columns. Capture with ${HARDWARE_COUNTER_CAPTURE_FLAG}=<groups>, such as ${HARDWARE_COUNTER_EXAMPLE_GROUPS}, to fill them.`;
export const NO_HARDWARE_COUNTER_COLUMNS_HINT =
    "This report's hardware counters include none of the table's units: FPU, SFPU, MATH, packer, unpackers, L1 bandwidth or NoC rings.";
