// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type ReactNode, useId } from 'react';
import classNames from 'classnames';
import { HARDWARE_COUNTER_ABSENCE_LABELS, HardwareCounterAbsence } from '../../definitions/HardwareCounters';
import {
    CB_WAIT_ZONE_LABELS,
    CbWaitZone,
    PIPELINE_THREAD_LABELS,
    PIPELINE_THREAD_ROLE_LABELS,
    STALL_SOURCE_LABELS,
    StallSource,
    StallState,
} from '../../definitions/PipelineStalls';
import { TEST_IDS } from '../../definitions/TestIds';
import { formatDuration } from '../../functions/formatting';
import { getMissingReason } from '../../functions/hardwareCounters';
import { MAX_PERCENT, NS_PER_US, clampPercent, formatPercentage } from '../../functions/math';
import {
    CbWait,
    NamedStallStat,
    OperationStalls,
    StallStat,
    ThreadHardwareCounters,
    ThreadStalls,
} from '../../model/PipelineStalls';
import MissingValue from './MissingValue';
import 'styles/components/DeviceOperationStalls.scss';

const PERCENT_DECIMALS = 1;
const NO_VALUE_REASON = HARDWARE_COUNTER_ABSENCE_LABELS[HardwareCounterAbsence.NO_VALUE];
const NO_SHARE_REASON = "no share of the kernel without the operation's core count and kernel duration";

const COUNTERS_HEADING = 'Threads · hardware counters';
const COUNTERS_CAPTION =
    "Each bar is the thread's share of the cycles the counters ran on each core, averaged across the cores that " +
    'ran the compute kernel: issuing an instruction, stalled on its next one, or idle with none to issue.';
const OVERLAP_NOTE =
    'Named waits are counted apart from the stalled share, not as a split of it: they overlap one another and it, so ' +
    'they never add up to it, and one can read above it.';
const MATH_PIPELINE_SUFFIX = 'of cycles a math instruction was ready';
const CB_HEADING = 'RISC-V poll time · instrumentation (sum zones)';
const CB_CAPTION_LEAD =
    "Time the unpack and pack cores spent polling circular buffers, which the stall counters can't see: tt-metal's " +
    "sum over the operation's";
const THREADS_NOT_CAPTURED = 'Thread stalls not captured';
const CB_NOT_CAPTURED = 'CB waits not captured';
const CB_NOT_CAPTURED_NOTE =
    "They time how long the unpack and pack cores polled circular buffers, which the stall counters can't see.";
const NO_COMPUTE_KERNEL =
    'No stall figures: this operation has no compute kernel, and tt-metal counts stalls and times CB waits only ' +
    'while one runs.';
const IGNORED_CB = "Its row repeats the previous operation's CB wait sums, which are ignored.";
const COUNTERS_NOT_RECORDED = 'No counters were recorded for this operation.';
const CB_NOT_RECORDED = 'No CB waits were recorded for this operation.';
const SUMMARY_TITLE = "The largest of the threads' stalled shares and CB poll shares, never their sum.";
const NO_NAMED_WAIT = 'no named wait reads above 0';
const DOWNSTREAM_WAIT = 'a wait on an earlier stage: read the threads before it';
const LEGEND = [
    { className: 'pipeline-stall-issuing', label: 'Issuing' },
    { className: 'pipeline-stall-stalled', label: 'Stalled' },
    { className: 'pipeline-stall-idle', label: 'Idle' },
];

const formatShare = (value: number): string => formatPercentage(value, PERCENT_DECIMALS);

const formatMicroseconds = (us: number): string => formatDuration(us * NS_PER_US);

const getThreadName = (thread: ThreadStalls): string =>
    `${PIPELINE_THREAD_LABELS[thread.thread]} ${PIPELINE_THREAD_ROLE_LABELS[thread.role]}`;

const getRange = (stat: StallStat): string | null =>
    stat.min !== null && stat.max !== null ? `${formatShare(stat.min)}–${formatShare(stat.max)}` : null;

const isAboveZero = (stat: NamedStallStat): boolean => (stat.max ?? stat.avg) > 0;

const describeShare = (value: number | null, part: string): string =>
    value === null ? `no ${part} value` : `${formatShare(value)} ${part}`;

const getCbCaption = (cores: number | null, kernelUs: number | null): string => {
    if (cores === null) {
        return `${CB_CAPTION_LEAD} cores, with no core count to average it over.`;
    }

    const share = kernelUs === null ? '' : `, as a share of its ${formatMicroseconds(kernelUs)} kernel`;

    return `${CB_CAPTION_LEAD} ${cores} cores, divided by ${cores}${share}.`;
};

interface WaitRowProps {
    wait: NamedStallStat;
    suffix?: string;
}

const WaitRow = ({ wait, suffix }: WaitRowProps) => {
    const range = getRange(wait);
    const value = formatShare(wait.avg);

    return (
        <>
            <span className='pipeline-stall-wait-name'>
                {wait.label}
                {suffix && <span className='pipeline-stall-muted pipeline-stall-subline'>{suffix}</span>}
            </span>
            <div
                className='pipeline-stall-wait-bar'
                role='img'
                aria-label={`${wait.label}: ${value}${suffix ? ` ${suffix}` : ''}`}
            >
                <div
                    className='pipeline-stall-wait-fill'
                    style={{ width: `${clampPercent(wait.avg)}%` }}
                />
            </div>
            <span
                className='pipeline-stall-value'
                title={range ? `${range} across cores` : undefined}
            >
                {value}
            </span>
        </>
    );
};

interface ThreadCountersProps {
    thread: ThreadStalls;
    counters: ThreadHardwareCounters;
}

const ThreadCounters = ({ thread, counters }: ThreadCountersProps) => {
    const name = getThreadName(thread);
    const issuing = counters.issue_rate?.avg ?? null;
    const stalled = counters.stall_rate?.avg ?? null;
    const issuingWidth = clampPercent(issuing);
    const stalledWidth = Math.min(clampPercent(stalled), MAX_PERCENT - issuingWidth);
    const pipelineStalls = (counters.math_pipeline_stalls ?? []).filter(isAboveZero);
    const zeroWaits = counters.zero_waits;
    const zeroWaitsId = useId();

    return (
        <div
            className='pipeline-stall-thread'
            data-testid={`${TEST_IDS.PIPELINE_STALL_THREAD}-${thread.thread}`}
        >
            <div className='pipeline-stall-thread-row'>
                <span className='pipeline-stall-thread-name'>{name}</span>
                <div
                    className='pipeline-stall-bar'
                    role='img'
                    aria-label={`${name}: ${describeShare(issuing, 'issuing')}, ${describeShare(stalled, 'stalled')}`}
                >
                    <div
                        className='pipeline-stall-issuing'
                        style={{ width: `${issuingWidth}%` }}
                    />
                    <div
                        className='pipeline-stall-stalled'
                        style={{ width: `${stalledWidth}%` }}
                    />
                </div>
                <span className='pipeline-stall-value'>
                    {issuing === null ? <MissingValue reason={NO_VALUE_REASON} /> : formatShare(issuing)} issuing ·{' '}
                    {stalled === null ? <MissingValue reason={NO_VALUE_REASON} /> : formatShare(stalled)} stalled
                </span>
            </div>
            {(counters.waits.length > 0 || pipelineStalls.length > 0) && (
                <div
                    className='pipeline-stall-waits'
                    data-testid={`${TEST_IDS.PIPELINE_STALL_WAITS}-${thread.thread}`}
                >
                    {counters.waits.map((wait) => (
                        <WaitRow
                            key={wait.label}
                            wait={wait}
                        />
                    ))}
                    {pipelineStalls.map((wait) => (
                        <WaitRow
                            key={wait.label}
                            wait={wait}
                            suffix={MATH_PIPELINE_SUFFIX}
                        />
                    ))}
                </div>
            )}
            {zeroWaits.length > 0 && (
                <>
                    <p
                        className='pipeline-stall-zero-waits'
                        title={zeroWaits.join(', ')}
                        aria-describedby={zeroWaitsId}
                        data-testid={`${TEST_IDS.PIPELINE_STALL_ZERO_WAITS}-${thread.thread}`}
                    >
                        {zeroWaits.length} named {zeroWaits.length === 1 ? 'wait reads' : 'waits read'} 0
                    </p>
                    {/* The tooltip's names, for assistive technology, which reads no `title`. */}
                    <span
                        id={zeroWaitsId}
                        hidden
                    >
                        {zeroWaits.join(', ')}
                    </span>
                </>
            )}
        </div>
    );
};

interface EmptyNoteProps {
    testId: string;
    children: ReactNode;
}

const EmptyNote = ({ testId, children }: EmptyNoteProps) => (
    <p
        className='pipeline-stall-empty'
        data-testid={testId}
    >
        {children}
    </p>
);

interface ThreadSectionProps {
    stalls: OperationStalls;
}

const ThreadSection = ({ stalls }: ThreadSectionProps) => {
    if (stalls.counters.state === StallState.NOT_CAPTURED) {
        return (
            <EmptyNote testId={TEST_IDS.PIPELINE_STALL_COUNTERS_EMPTY}>
                {getMissingReason(THREADS_NOT_CAPTURED, stalls.counters.fill_hint)}.
            </EmptyNote>
        );
    }

    const counted = stalls.threads.flatMap((thread) =>
        thread.hardware_counters ? [{ thread, counters: thread.hardware_counters }] : [],
    );

    if (counted.length === 0) {
        return <EmptyNote testId={TEST_IDS.PIPELINE_STALL_COUNTERS_EMPTY}>{COUNTERS_NOT_RECORDED}</EmptyNote>;
    }

    const hasWaits = counted.some(({ counters }) => counters.waits.length > 0);

    return (
        <>
            <p className='pipeline-stall-caption'>{COUNTERS_CAPTION}</p>
            <ul className='pipeline-stall-legend'>
                {LEGEND.map(({ className, label }) => (
                    <li key={label}>
                        <span className={classNames('pipeline-stall-swatch', className)} />
                        {label}
                    </li>
                ))}
            </ul>
            {counted.map(({ thread, counters }) => (
                <ThreadCounters
                    key={thread.thread}
                    thread={thread}
                    counters={counters}
                />
            ))}
            {hasWaits && (
                <p
                    className='pipeline-stall-caption'
                    data-testid={TEST_IDS.PIPELINE_STALL_OVERLAP_NOTE}
                >
                    {OVERLAP_NOTE}
                </p>
            )}
        </>
    );
};

interface CbWaitRowProps {
    zone: CbWaitZone;
    wait: CbWait | null;
    coreCount: number | null;
}

const CbWaitRow = ({ zone, wait, coreCount }: CbWaitRowProps) => {
    const { thread, waitingFor } = CB_WAIT_ZONE_LABELS[zone];
    const name = `${PIPELINE_THREAD_LABELS[thread]} ${zone}`;
    const share = wait?.kernel_share_percent ?? null;
    const perCore = wait?.per_core_us ?? null;
    const summed = wait && coreCount ? `${formatMicroseconds(wait.sum_us)} summed over ${coreCount} cores` : undefined;

    return (
        <>
            <span className='pipeline-stall-thread-name'>
                {name}
                <span className='pipeline-stall-muted pipeline-stall-subline'>{waitingFor}</span>
            </span>
            {wait === null ? (
                <span
                    className='pipeline-stall-absent'
                    role='img'
                    aria-label={`${name}: ${NO_VALUE_REASON}`}
                >
                    {NO_VALUE_REASON}
                </span>
            ) : (
                <>
                    <div
                        className='pipeline-stall-bar'
                        role='img'
                        aria-label={`${name}: ${share === null ? NO_SHARE_REASON : `${formatShare(share)} of the kernel`}`}
                        data-testid={`${TEST_IDS.PIPELINE_STALL_CB_WAIT}-${zone}`}
                    >
                        <div
                            className='pipeline-stall-poll'
                            style={{ width: `${clampPercent(share)}%` }}
                        />
                    </div>
                    <span
                        className='pipeline-stall-value'
                        title={summed}
                    >
                        {share === null ? <MissingValue reason={NO_SHARE_REASON} /> : formatShare(share)}
                        {perCore !== null && (
                            <span className='pipeline-stall-muted'> · {formatMicroseconds(perCore)} per core</span>
                        )}
                    </span>
                </>
            )}
        </>
    );
};

interface CbSectionProps {
    stalls: OperationStalls;
}

const CbSection = ({ stalls }: CbSectionProps) => {
    if (stalls.cb_waits.state === StallState.NOT_CAPTURED) {
        return (
            <EmptyNote testId={TEST_IDS.PIPELINE_STALL_CB_EMPTY}>
                {getMissingReason(CB_NOT_CAPTURED, stalls.cb_waits.fill_hint)}. {CB_NOT_CAPTURED_NOTE}
            </EmptyNote>
        );
    }

    if (stalls.cb_waits.state !== StallState.FILLED) {
        return <EmptyNote testId={TEST_IDS.PIPELINE_STALL_CB_EMPTY}>{CB_NOT_RECORDED}</EmptyNote>;
    }

    const cores = stalls.core_count;

    return (
        <>
            <p className='pipeline-stall-caption'>{getCbCaption(cores, stalls.kernel_duration_us)}</p>
            <div className='pipeline-stall-grid'>
                {Object.values(CbWaitZone).map((zone) => {
                    const { thread } = CB_WAIT_ZONE_LABELS[zone];
                    const entry = stalls.threads.find((candidate) => candidate.thread === thread);

                    return (
                        <CbWaitRow
                            key={zone}
                            zone={zone}
                            wait={entry?.instrumentation?.[zone] ?? null}
                            coreCount={cores}
                        />
                    );
                })}
            </div>
        </>
    );
};

const getSummary = (stalls: OperationStalls): string | null => {
    const thread = stalls.threads.find((candidate) => candidate.thread === stalls.stalled_thread);

    if (stalls.stalled_percent === null || !thread) {
        return null;
    }

    const head = `Largest stall: ${getThreadName(thread)}, ${formatShare(stalls.stalled_percent)}`;
    const wait = stalls.largest_wait;

    if (!wait) {
        return `${head}, ${NO_NAMED_WAIT}`;
    }

    if (wait.source === StallSource.INSTRUMENTATION) {
        return `${head}, polling ${wait.label} (${STALL_SOURCE_LABELS[wait.source]})`;
    }

    const named = `${head}, ${wait.label} ${formatShare(wait.percent)} (${STALL_SOURCE_LABELS[wait.source]})`;

    return wait.downstream ? `${named}, ${DOWNSTREAM_WAIT}` : named;
};

interface DeviceOperationStallsProps {
    stalls: OperationStalls;
}

/** One operation's stalls per compute thread, beside the CB poll time the counters can't see. #2372 */
const DeviceOperationStalls = ({ stalls }: DeviceOperationStallsProps) => {
    if (stalls.has_compute_kernel === false) {
        return (
            <div
                className='pipeline-stalls'
                data-testid={TEST_IDS.PIPELINE_STALLS}
            >
                <p
                    className='pipeline-stall-note'
                    data-testid={TEST_IDS.PIPELINE_STALL_NOTE}
                >
                    {NO_COMPUTE_KERNEL}
                    {stalls.cb_waits.state === StallState.IGNORED && ` ${IGNORED_CB}`}
                </p>
            </div>
        );
    }

    const summary = getSummary(stalls);

    return (
        <div
            className='pipeline-stalls'
            data-testid={TEST_IDS.PIPELINE_STALLS}
        >
            {summary && (
                <p
                    className='pipeline-stall-summary'
                    title={SUMMARY_TITLE}
                    data-testid={TEST_IDS.PIPELINE_STALL_SUMMARY}
                >
                    {summary}
                </p>
            )}
            <div className='pipeline-stall-heading'>{COUNTERS_HEADING}</div>
            <ThreadSection stalls={stalls} />
            <div className='pipeline-stall-heading'>{CB_HEADING}</div>
            <CbSection stalls={stalls} />
        </div>
    );
};

export default DeviceOperationStalls;
