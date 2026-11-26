// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { OpType } from '../definitions/Performance';
import { Operation } from '../model/APIData';
import { TypedPerfTableRow } from '../model/PerfTable';
import { isCountableDeviceTime } from './durationBuckets';
import { getPathBasename } from './formatting';
import { StackTraceFrame, formatFrameLabel, getCallSiteFrame } from './stackTraceSource';

export enum SourceLineGroupKind {
    LINE = 'line',
    // Performance rows with no linked memory-report operation.
    UNLINKED = 'unlinked',
    // Linked operations missing from the operations list, or whose trace names no frame.
    NO_TRACE = 'no_trace',
}

export const TOP_OP_CODE_COUNT = 3;
export const SOURCE_LINE_UNLINKED_LABEL = 'No linked operation';
export const SOURCE_LINE_NO_TRACE_LABEL = 'No source line in trace';
// Prefixes the line of a call site whose path names no file, such as `File ""` or `File "/m/"`.
export const SOURCE_LINE_NO_FILE_LABEL = 'No file name';

// Cannot appear in a path, so no file name can make two keys collide.
const KEY_SEPARATOR = '\u0000';

export type SourceLineOperation = Pick<Operation, 'stack_trace' | 'stack_trace_source_file_id'>;

export interface SourceLineGroup {
    key: string;
    kind: SourceLineGroupKind;
    filePath: string | null;
    basename: string | null;
    lineNumber: number | null;
    functionName: string | null;
    // Set only while devices are unmerged, mirroring the stacked table's Device column.
    device: number | null;
    deviceTimeUs: number;
    percent: number;
    rowCount: number;
    topOpCodes: string[];
    // Unique, in the order the rows first name them.
    operationIds: number[];
    // The first linked operation's. It is frame 0's file: tt-metal's writer stores one file per
    // trace, its first frame's (see `getFrameSourceFileId`).
    sourceFileId: number | null;
}

interface SourceLineAccumulator extends Omit<SourceLineGroup, 'percent' | 'topOpCodes'> {
    deviceTimeByOpCode: Map<string, number>;
    // A line inside a loop can link thousands of operations, so membership is not a list scan.
    operationIdSet: Set<number>;
}

export const getSourceLineGroupKey = (
    kind: SourceLineGroupKind,
    frame: Pick<StackTraceFrame, 'file' | 'line'> | null,
    device: number | null,
): string => [kind, frame?.file ?? '', frame?.line ?? '', device ?? ''].join(KEY_SEPARATOR);

export const getSourceLineGroupLabel = (group: SourceLineGroup): string => {
    if (group.kind === SourceLineGroupKind.UNLINKED) {
        return SOURCE_LINE_UNLINKED_LABEL;
    }

    if (group.kind === SourceLineGroupKind.NO_TRACE) {
        return SOURCE_LINE_NO_TRACE_LABEL;
    }

    // `LINE` groups always carry a call site, so `filePath` and `lineNumber` are set.
    const lineNumber = group.lineNumber ?? 0;

    return (
        formatFrameLabel({ file: group.filePath ?? '', line: lineNumber }) ||
        `${SOURCE_LINE_NO_FILE_LABEL}:${lineNumber}`
    );
};

const getTopOpCodes = (deviceTimeByOpCode: Map<string, number>): string[] =>
    [...deviceTimeByOpCode]
        .sort(([opCodeA, timeA], [opCodeB, timeB]) => timeB - timeA || opCodeA.localeCompare(opCodeB))
        .slice(0, TOP_OP_CODE_COUNT)
        .map(([opCode]) => opCode);

/**
 * Roll performance rows up by the call site of their linked operation: frame 0 of its stack
 * trace, keyed by full path and line (and device, while devices are unmerged) so two files
 * that share a basename stay apart.
 *
 * Device time is summed per line, as tt-perf-report's `Device_Time_Sum_us` sums it, so the
 * percentages add up to 100 (per device, while devices are unmerged, as tt-perf-report's own
 * `%` does). `aggregatePerfByOp` takes the max per operation instead, so the graph view's
 * numbers can differ. Every non-signpost row adds to its group's row count; only countable
 * device time (`isCountableDeviceTime`) adds to its time.
 *
 * Sorted by device time, largest first. While devices are unmerged, sorted by device first, as
 * tt-perf-report orders its stacked CSV, so each device's shares read in order.
 *
 * Mirrored as `source_line_groups` in `backend/ttnn_visualizer/agent/source_lines.py`, behind
 * the `source_lines` MCP tool (#2364). No golden holds the two together yet (#2370), so mirror a
 * change to either side by hand. The tool answers the same question, but differs from this view:
 * - Range: this covers the rows it is given, which `PerfReport` takes from the range slider;
 *   the tool reads the whole report or a signpost range.
 * - No call site: both decline when no trace names a Python frame. `PerfReport` checks every
 *   operation in the memory report, linked or not; the tool checks only the linked operations'
 *   traces, at the linked rank. So a call site only on an unlinked operation leaves this enabled
 *   while the tool refuses.
 * - Unmerged devices: this keeps a group per line per device, each a share of its device.
 * - Trace: this reads the call site from the operation list's `stack_trace`, which keeps an
 *   operation's last `stack_traces` row, keyed by operation and rank. The tool reads the first,
 *   so the two can differ for an operation with several traces, on one rank or several.
 * The tool's `SOURCE_LINES_NOTE` lists the rest: line 0 or past 2**31, which the tool files
 * under `no_trace`; ties in path or op code, which the tool breaks by code point and this by
 * locale; `null` shares where this shows 0%; and its count of host ops among unlinked rows.
 */
export const getSourceLineGroups = (
    rows: TypedPerfTableRow[],
    operationById: ReadonlyMap<number, SourceLineOperation>,
    { mergeDevices }: { mergeDevices: boolean },
): SourceLineGroup[] => {
    const accumulatorByKey = new Map<string, SourceLineAccumulator>();
    // Each operation's trace is parsed once, however many rows it has.
    const callSiteByOpId = new Map<number, StackTraceFrame | null>();

    const getCallSite = (opId: number): StackTraceFrame | null => {
        if (!callSiteByOpId.has(opId)) {
            const operation = operationById.get(opId);
            callSiteByOpId.set(opId, operation ? getCallSiteFrame(operation.stack_trace) : null);
        }

        return callSiteByOpId.get(opId) ?? null;
    };

    for (const row of rows.filter((candidate) => candidate.op_type !== OpType.SIGNPOST)) {
        const opId = row.op ?? null;
        const callSite = opId !== null ? getCallSite(opId) : null;
        let kind = SourceLineGroupKind.LINE;

        if (opId === null) {
            kind = SourceLineGroupKind.UNLINKED;
        } else if (callSite === null) {
            kind = SourceLineGroupKind.NO_TRACE;
        }

        const device = mergeDevices ? null : row.device;
        const key = getSourceLineGroupKey(kind, callSite, device);
        let accumulator = accumulatorByKey.get(key);

        if (!accumulator) {
            accumulator = {
                key,
                kind,
                filePath: callSite?.file ?? null,
                basename: callSite ? getPathBasename(callSite.file) : null,
                lineNumber: callSite?.line ?? null,
                functionName: callSite?.function ?? null,
                device,
                deviceTimeUs: 0,
                rowCount: 0,
                operationIds: [],
                sourceFileId:
                    callSite && opId !== null ? (operationById.get(opId)?.stack_trace_source_file_id ?? null) : null,
                deviceTimeByOpCode: new Map(),
                operationIdSet: new Set(),
            };
            accumulatorByKey.set(key, accumulator);
        }

        accumulator.rowCount += 1;

        if (isCountableDeviceTime(row.device_time)) {
            accumulator.deviceTimeUs += row.device_time;
            accumulator.deviceTimeByOpCode.set(
                row.raw_op_code,
                (accumulator.deviceTimeByOpCode.get(row.raw_op_code) ?? 0) + row.device_time,
            );
        }

        if (opId !== null && !accumulator.operationIdSet.has(opId)) {
            accumulator.operationIdSet.add(opId);
            accumulator.operationIds.push(opId);
        }
    }

    const accumulators = [...accumulatorByKey.values()];
    // Keyed by device, which is null throughout while devices are merged. Unmerged, each line's
    // share is of its own device's time, as tt-perf-report computes the other groupings' `%`.
    const totalDeviceTimeByDevice = new Map<number | null, number>();

    for (const accumulator of accumulators) {
        totalDeviceTimeByDevice.set(
            accumulator.device,
            (totalDeviceTimeByDevice.get(accumulator.device) ?? 0) + accumulator.deviceTimeUs,
        );
    }

    return accumulators
        .map(({ deviceTimeByOpCode, operationIdSet: _operationIdSet, ...group }) => {
            const deviceTotalUs = totalDeviceTimeByDevice.get(group.device) ?? 0;

            return {
                ...group,
                percent: deviceTotalUs > 0 ? (group.deviceTimeUs / deviceTotalUs) * 100 : 0,
                topOpCodes: getTopOpCodes(deviceTimeByOpCode),
            };
        })
        .sort(
            (a, b) =>
                (a.device ?? 0) - (b.device ?? 0) || b.deviceTimeUs - a.deviceTimeUs || a.key.localeCompare(b.key),
        );
};

/** The search text as it is matched, and as matches are highlighted. */
export const normaliseSourceLineQuery = (query: string): string => query.trim();

/**
 * The number of distinct source lines among the groups: each per-device group of a line counts
 * once, and the groups with no call site not at all.
 */
export const countSourceLines = (groups: readonly SourceLineGroup[]): number =>
    new Set(
        groups
            .filter((group) => group.kind === SourceLineGroupKind.LINE)
            .map((group) => [group.filePath, group.lineNumber].join(KEY_SEPARATOR)),
    ).size;

/**
 * Whether a group matches the op-code search box, which under Source line searches the call
 * site's path, basename, `basename:line` (`No file name:<line>` when the path names no file) and
 * function. The two groups without a call site match on their labels.
 */
export const isSourceLineGroupMatch = (group: SourceLineGroup, query: string): boolean => {
    const needle = normaliseSourceLineQuery(query).toLowerCase();

    if (!needle) {
        return true;
    }

    return [getSourceLineGroupLabel(group), group.filePath, group.functionName].some(
        (value) => value?.toLowerCase().includes(needle) ?? false,
    );
};
