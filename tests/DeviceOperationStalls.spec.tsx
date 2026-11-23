// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DeviceOperationStalls from '../src/components/operation-details/DeviceOperationStalls';
import { CbWaitZone, PipelineThread, StallSource } from '../src/definitions/PipelineStalls';
import { TEST_IDS } from '../src/definitions/TestIds';
import { OperationStalls } from '../src/model/PipelineStalls';
import {
    CB_WAITS_FILL_HINT,
    COUNTERS_FILL_HINT,
    INPUT_STARVED_STALLS,
    NOT_CAPTURED_STALLS,
    NO_CB_VALUE_STALLS,
    NO_COMPUTE_KERNEL_STALLS,
    NO_CORE_COUNT_STALLS,
    NO_SUM_PROFILING_STALLS,
    SCOREBOARD_STALLS,
    T0_ZERO_WAITS,
    UNNAMED_STALL_STALLS,
    UNPACK_BOUND_STALLS,
    UNRECORDED_STALLS,
    named,
    stat,
} from './helpers/pipelineStallFixtures';

const renderStalls = (stalls: OperationStalls) => render(<DeviceOperationStalls stalls={stalls} />).container;

const threadBlock = (thread: PipelineThread) => screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_THREAD}-${thread}`);

const threadBar = (thread: PipelineThread) => within(threadBlock(thread)).getAllByRole('img')[0];

const segmentWidths = (bar: HTMLElement) => [...bar.children].map((segment) => (segment as HTMLElement).style.width);

const NO_VALUE = 'no value for this operation';

const withT0Counters = (issue: number, stall: number): OperationStalls => ({
    ...INPUT_STARVED_STALLS,
    threads: INPUT_STARVED_STALLS.threads.map((entry) =>
        entry.thread === PipelineThread.T0 && entry.hardware_counters
            ? {
                  ...entry,
                  hardware_counters: { ...entry.hardware_counters, issue_rate: stat(issue), stall_rate: stat(stall) },
              }
            : entry,
    ),
});

afterEach(cleanup);

describe('DeviceOperationStalls', () => {
    describe('thread bars', () => {
        it('draws one bar per thread: issuing, then stalled, with the rest idle', () => {
            renderStalls(INPUT_STARVED_STALLS);

            expect(threadBar(PipelineThread.T0)).toHaveAttribute('aria-label', 'T0 Unpack: 3.1% issuing, 2% stalled');
            expect(segmentWidths(threadBar(PipelineThread.T0))).toEqual(['3.1%', '2%']);
            expect(threadBar(PipelineThread.T1)).toHaveAttribute('aria-label', 'T1 Math: 10.8% issuing, 0.6% stalled');
            expect(threadBar(PipelineThread.T2)).toHaveAttribute('aria-label', 'T2 Pack: 8.1% issuing, 11.2% stalled');
            expect(screen.getByText('Idle')).toBeInTheDocument();
        });

        it('labels the bars as hardware counters', () => {
            renderStalls(INPUT_STARVED_STALLS);

            expect(screen.getByText('Threads · hardware counters')).toBeInTheDocument();
        });

        it('never draws a bar past its end when the two averages add up past 100%', () => {
            renderStalls(withT0Counters(70, 45));

            expect(segmentWidths(threadBar(PipelineThread.T0))).toEqual(['70%', '30%']);
        });

        it("lists each thread's named waits above 0 by average, each its own bar", () => {
            renderStalls(INPUT_STARVED_STALLS);

            const waits = screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_WAITS}-${PipelineThread.T2}`);
            const bars = within(waits).getAllByRole('img');

            expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
                'Semaphore Zero Wait T2: 76.4%',
                'Pack Idle Wait T2: 1.9%',
            ]);
            expect((bars[0].firstElementChild as HTMLElement).style.width).toBe('76.4%');
        });

        it('names the waits that read 0 by count, listing them on hover, rather than as rows', () => {
            renderStalls(INPUT_STARVED_STALLS);

            const zero = screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_ZERO_WAITS}-${PipelineThread.T0}`);
            const waits = screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_WAITS}-${PipelineThread.T0}`);

            expect(zero).toHaveTextContent(`${T0_ZERO_WAITS.length} named waits read 0`);
            expect(zero).toHaveAttribute('title', T0_ZERO_WAITS.join(', '));
            expect(waits).not.toHaveTextContent('SrcA Clear Wait');
        });

        it('names a single wait that reads 0 in the singular', () => {
            renderStalls({
                ...INPUT_STARVED_STALLS,
                threads: INPUT_STARVED_STALLS.threads.map((entry) =>
                    entry.thread === PipelineThread.T2 && entry.hardware_counters
                        ? {
                              ...entry,
                              hardware_counters: { ...entry.hardware_counters, zero_waits: ['Semaphore Full Wait T2'] },
                          }
                        : entry,
                ),
            });

            expect(screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_ZERO_WAITS}-${PipelineThread.T2}`)).toHaveTextContent(
                '1 named wait reads 0',
            );
        });

        it('notes that waits overlap and never add up to the stalled share', () => {
            renderStalls(INPUT_STARVED_STALLS);

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_OVERLAP_NOTE)).toHaveTextContent(
                'they never add up to it',
            );
        });

        it('leaves the overlap note out when no thread has a wait to list', () => {
            renderStalls({
                ...INPUT_STARVED_STALLS,
                threads: INPUT_STARVED_STALLS.threads.map((entry) => ({
                    ...entry,
                    hardware_counters: entry.hardware_counters && { ...entry.hardware_counters, waits: [] },
                })),
            });

            expect(screen.queryByTestId(TEST_IDS.PIPELINE_STALL_OVERLAP_NOTE)).toBeNull();
        });

        it("shows the math pipeline's stalls above 0 on the math thread, saying what they are a share of", () => {
            renderStalls(SCOREBOARD_STALLS);

            const waits = screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_WAITS}-${PipelineThread.T1}`);

            expect(waits).toHaveTextContent('Math Scoreboard Stall Rate');
            expect(waits).toHaveTextContent('of cycles a math instruction was ready');
            expect(waits).not.toHaveTextContent('Data Hazard Stall Rate');
        });

        it('marks a missing issue rate with a dash named for the reason, and says so in the bar', () => {
            renderStalls({
                ...INPUT_STARVED_STALLS,
                threads: INPUT_STARVED_STALLS.threads.map((entry) =>
                    entry.thread === PipelineThread.T0 && entry.hardware_counters
                        ? { ...entry, hardware_counters: { ...entry.hardware_counters, issue_rate: null } }
                        : entry,
                ),
            });

            expect(threadBar(PipelineThread.T0)).toHaveAttribute(
                'aria-label',
                'T0 Unpack: no issuing value, 2% stalled',
            );
            expect(within(threadBlock(PipelineThread.T0)).getByLabelText(NO_VALUE)).toHaveTextContent('—');
        });

        it("gives a wait's range across cores on hover", () => {
            renderStalls({
                ...INPUT_STARVED_STALLS,
                threads: INPUT_STARVED_STALLS.threads.map((entry) =>
                    entry.thread === PipelineThread.T2 && entry.hardware_counters
                        ? {
                              ...entry,
                              hardware_counters: {
                                  ...entry.hardware_counters,
                                  waits: [{ ...named('Semaphore Zero Wait T2', 76.4), min: 72.5, max: 78.1 }],
                              },
                          }
                        : entry,
                ),
            });

            expect(screen.getByText('76.4%')).toHaveAttribute('title', '72.5%–78.1% across cores');
        });
    });

    describe('CB poll time', () => {
        it("draws the unpack and pack cores' CB polls as their own bars, labelled as instrumentation", () => {
            renderStalls(INPUT_STARVED_STALLS);

            expect(screen.getByText('RISC-V poll time · instrumentation (sum zones)')).toBeInTheDocument();
            expect(screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_CB_WAIT}-${CbWaitZone.WAIT_FRONT}`)).toHaveAttribute(
                'aria-label',
                'T0 cb_wait_front: 76.2% of the kernel',
            );
            expect(screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_CB_WAIT}-${CbWaitZone.RESERVE_BACK}`)).toHaveAttribute(
                'aria-label',
                'T2 cb_reserve_back: 14.4% of the kernel',
            );
            expect(screen.getByText('waiting for input')).toBeInTheDocument();
            expect(screen.getByText('waiting for output space')).toBeInTheDocument();
        });

        it("says the counters can't see the polls, and that the CSV's sum is divided by the op's cores", () => {
            const container = renderStalls(INPUT_STARVED_STALLS);

            expect(container).toHaveTextContent("which the stall counters can't see");
            expect(container).toHaveTextContent("sum over the operation's 88 cores, divided by 88");
            expect(container).toHaveTextContent('as a share of its 26 µs kernel');
        });

        it('shows the average per core beside the share, and the sum on hover', () => {
            renderStalls(INPUT_STARVED_STALLS);

            const value = screen.getByText('76.2%', { selector: '.pipeline-stall-value' });

            expect(value).toHaveTextContent('76.2% · 19.8 µs per core');
            expect(value).toHaveAttribute('title', '1.74 ms summed over 88 cores');
        });

        it("says what fills the CB waits, as the server words it, when the capture didn't time them", () => {
            renderStalls(NO_SUM_PROFILING_STALLS);

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_CB_EMPTY)).toHaveTextContent(
                `CB waits not captured: ${CB_WAITS_FILL_HINT}.`,
            );
            expect(screen.queryByTestId(`${TEST_IDS.PIPELINE_STALL_CB_WAIT}-${CbWaitZone.WAIT_FRONT}`)).toBeNull();
            expect(threadBar(PipelineThread.T0)).toBeInTheDocument();
        });

        it('says no CB wait was recorded, naming no flag, for an op of a capture that timed others', () => {
            renderStalls(NO_CB_VALUE_STALLS);

            const empty = screen.getByTestId(TEST_IDS.PIPELINE_STALL_CB_EMPTY);

            expect(empty).toHaveTextContent('No CB waits were recorded for this operation.');
            expect(empty).not.toHaveTextContent('--enable-sum-profiling');
        });

        it('names a poll the row lacks as an image, as the counters panel names an absence', () => {
            renderStalls({
                ...INPUT_STARVED_STALLS,
                threads: INPUT_STARVED_STALLS.threads.map((entry) =>
                    entry.thread === PipelineThread.T2 ? { ...entry, instrumentation: null } : entry,
                ),
            });

            expect(screen.getByRole('img', { name: `T2 cb_reserve_back: ${NO_VALUE}` })).toHaveTextContent(NO_VALUE);
        });

        it('averages over no cores, and gives no share, when the row has no usable core count', () => {
            const container = renderStalls(NO_CORE_COUNT_STALLS);

            expect(container).toHaveTextContent(
                "sum over the operation's cores, with no core count to average it over.",
            );
            expect(container).not.toHaveTextContent('divided by');
            expect(screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_CB_WAIT}-${CbWaitZone.WAIT_FRONT}`)).toHaveAttribute(
                'aria-label',
                "T0 cb_wait_front: no share of the kernel without the operation's core count and kernel duration",
            );
        });
    });

    describe('summary', () => {
        it('names the largest stall and the CB poll behind it', () => {
            renderStalls(INPUT_STARVED_STALLS);

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_SUMMARY)).toHaveTextContent(
                'Largest stall: T0 Unpack, 76.2%, polling cb_wait_front (instrumentation)',
            );
        });

        it("names the pack core's poll when cb_reserve_back is the largest stall", () => {
            const share =
                INPUT_STARVED_STALLS.threads[2].instrumentation?.[CbWaitZone.RESERVE_BACK]?.kernel_share_percent;

            renderStalls({
                ...INPUT_STARVED_STALLS,
                stalled_percent: share ?? null,
                stalled_thread: PipelineThread.T2,
                largest_wait: {
                    label: CbWaitZone.RESERVE_BACK,
                    source: StallSource.INSTRUMENTATION,
                    percent: share ?? 0,
                    downstream: false,
                },
            });

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_SUMMARY)).toHaveTextContent(
                'Largest stall: T2 Pack, 14.4%, polling cb_reserve_back (instrumentation)',
            );
        });

        it("names a stall rate's largest named wait, with its own share", () => {
            renderStalls(UNPACK_BOUND_STALLS);

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_SUMMARY)).toHaveTextContent(
                'Largest stall: T0 Unpack, 27.7%, Unpack Idle Wait T0 27.8% (hardware counter)',
            );
        });

        it('says the largest wait is a symptom when it waits on an earlier stage', () => {
            renderStalls(NO_SUM_PROFILING_STALLS);

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_SUMMARY)).toHaveTextContent(
                'Largest stall: T2 Pack, 11.2%, Semaphore Zero Wait T2 76.4% (hardware counter), a wait on an earlier ' +
                    'stage: read the threads before it',
            );
        });

        it('says when no named wait explains the largest stall', () => {
            renderStalls(UNNAMED_STALL_STALLS);

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_SUMMARY)).toHaveTextContent(
                'Largest stall: T1 Math, 40%, no named wait reads above 0',
            );
        });
    });

    describe('empty states', () => {
        it('says what fills each part when a capture of other counter groups has neither', () => {
            renderStalls(NOT_CAPTURED_STALLS);

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_COUNTERS_EMPTY)).toHaveTextContent(
                `Thread stalls not captured: ${COUNTERS_FILL_HINT}.`,
            );
            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_CB_EMPTY)).toHaveTextContent(CB_WAITS_FILL_HINT);
            expect(screen.queryByRole('img')).toBeNull();
            expect(screen.queryByTestId(TEST_IDS.PIPELINE_STALL_SUMMARY)).toBeNull();
        });

        it('says an operation without a compute kernel has no figures, and that its copied CB sums are ignored', () => {
            renderStalls(NO_COMPUTE_KERNEL_STALLS);

            const note = screen.getByTestId(TEST_IDS.PIPELINE_STALL_NOTE);

            expect(note).toHaveTextContent('this operation has no compute kernel');
            expect(note).toHaveTextContent("repeats the previous operation's CB wait sums, which are ignored");
            expect(screen.queryByRole('img')).toBeNull();
            expect(screen.queryByTestId(TEST_IDS.PIPELINE_STALL_CB_EMPTY)).toBeNull();
        });

        it('mentions no ignored sums for an operation without a compute kernel or any CB sums', () => {
            renderStalls({ ...NO_COMPUTE_KERNEL_STALLS, cb_waits: NOT_CAPTURED_STALLS.cb_waits });

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_NOTE)).not.toHaveTextContent('ignored');
        });

        it("draws the whole panel for a row that doesn't say whether it has a compute kernel", () => {
            renderStalls({ ...INPUT_STARVED_STALLS, has_compute_kernel: null });

            expect(screen.queryByTestId(TEST_IDS.PIPELINE_STALL_NOTE)).toBeNull();
            expect(threadBar(PipelineThread.T0)).toBeInTheDocument();
            expect(
                screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_CB_WAIT}-${CbWaitZone.WAIT_FRONT}`),
            ).toBeInTheDocument();
        });

        it('says counters were not recorded for a compute operation, still drawing its CB polls', () => {
            renderStalls(UNRECORDED_STALLS);

            expect(screen.getByTestId(TEST_IDS.PIPELINE_STALL_COUNTERS_EMPTY)).toHaveTextContent(
                'No counters were recorded for this operation.',
            );
            expect(
                screen.getByTestId(`${TEST_IDS.PIPELINE_STALL_CB_WAIT}-${CbWaitZone.WAIT_FRONT}`),
            ).toBeInTheDocument();
        });
    });
});
