// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NPEValidationError } from '../src/definitions/NPEData';
import { ReportKind, ReportLoadFailureReason, ReportSource } from '../src/definitions/UsageEvent';
import useNpeLoadAttempt from '../src/hooks/useNpeLoadAttempt';

const { recordReportLoaded, recordReportLoadFailed } = vi.hoisted(() => ({
    recordReportLoaded: vi.fn(),
    recordReportLoadFailed: vi.fn(),
}));

vi.mock('../src/functions/reportLoadUsage', async (importOriginal) => {
    const { reportLoadUsageSpiesMock } = await import('./helpers/mockReportLoadUsage');

    return reportLoadUsageSpiesMock(importOriginal, recordReportLoaded, recordReportLoadFailed);
});

beforeEach(() => {
    vi.clearAllMocks();
});

it('settles an active failure at most once', () => {
    const { result } = renderHook(() => useNpeLoadAttempt());

    act(() => result.current.begin(ReportSource.UPLOAD));
    const attemptId = result.current.controller.id;
    expect(attemptId).not.toBeNull();

    act(() => result.current.controller.fail(attemptId ?? -1, NPEValidationError.INVALID_JSON));
    act(() => {
        result.current.controller.fail(attemptId ?? -1, NPEValidationError.DEFAULT);
        result.current.controller.complete(attemptId ?? -1);
    });

    expect(recordReportLoadFailed).toHaveBeenCalledTimes(1);
    expect(recordReportLoadFailed).toHaveBeenCalledWith(ReportKind.NPE, ReportLoadFailureReason.PARSE_ERROR);
    expect(recordReportLoaded).not.toHaveBeenCalled();
});

it('ignores stale failures after a newer attempt begins', () => {
    const { result } = renderHook(() => useNpeLoadAttempt());

    act(() => result.current.begin(ReportSource.UPLOAD));
    const staleAttemptId = result.current.controller.id;
    act(() => result.current.begin(ReportSource.DEMO));
    const activeAttemptId = result.current.controller.id;

    act(() => result.current.controller.fail(staleAttemptId ?? -1, NPEValidationError.INVALID_JSON));
    expect(recordReportLoadFailed).not.toHaveBeenCalled();

    act(() => result.current.controller.complete(activeAttemptId ?? -1));
    expect(recordReportLoaded).toHaveBeenCalledOnce();
    expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.NPE, ReportSource.DEMO);
});
