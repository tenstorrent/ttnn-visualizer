// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The footer's range control is mounted on every route and owns the response to a
 * performance report that fails to load. A refused signpost range is a fault in the
 * view rather than the report, so it must cost the range, not the report: the range
 * is keyed to the report, and unloading it would have the range refuse it again on
 * reopening.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { AxiosError, AxiosHeaders, HttpStatusCode } from 'axios';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Range from '../src/components/RangeSlider';
import createToastNotification from '../src/functions/createToastNotification';
import { ToastType } from '../src/definitions/ToastType';
import { usePerformanceReport } from '../src/hooks/useAPI';
import { activePerformanceReportAtom, filterBySignpostAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import type { AtomProviderInitialValues } from './helpers/atomProvider';

vi.mock('../src/hooks/useAPI', () => ({
    useGetClusterDescription: () => ({ error: null }),
    useGetDeviceOperationListPerf: () => [],
    useOpToPerfIdFiltered: () => [],
    useOperationListRange: () => null,
    useOperationsList: () => ({ data: undefined }),
    usePerformanceRange: () => null,
    usePerformanceReport: vi.fn(),
}));

vi.mock('../src/functions/createToastNotification', () => ({
    default: vi.fn(),
}));

const REPORT = { path: 'report-a', reportName: 'report-a' };
const START = { id: 4, op_code: 'PERF_DECODE' };
const END = { id: 90, op_code: 'PERF_DECODE_END' };
const REFUSAL = "end signpost 'PERF_DECODE_END' resolves to id 3, before start signpost 'PERF_DECODE' at id 4";

const failedWith = (status: HttpStatusCode, message: string) =>
    new AxiosError(message, AxiosError.ERR_BAD_REQUEST, undefined, undefined, {
        data: { error: message },
        status,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
    });

function AtomProbe() {
    const report = useAtomValue(activePerformanceReportAtom);
    const range = useAtomValue(filterBySignpostAtom);

    return (
        <>
            <span data-testid='active-report'>{report?.reportName ?? 'none'}</span>
            <span data-testid='signpost-range'>{range.map((signpost) => signpost?.op_code ?? '-').join(',')}</span>
        </>
    );
}

const renderWith = (withRange: boolean) => {
    // The range is recorded against whichever report is active when it is set, so the
    // report goes first.
    const initialAtomValues: AtomProviderInitialValues = [[activePerformanceReportAtom, REPORT]];
    if (withRange) {
        initialAtomValues.push([filterBySignpostAtom, [START, END]]);
    }

    return render(
        <TestProviders initialAtomValues={initialAtomValues}>
            <Range />
            <AtomProbe />
        </TestProviders>,
    );
};

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(cleanup);

describe('a performance report that fails to load', () => {
    it('drops a refused signpost range and keeps the report', async () => {
        // As the real query does: the range is part of its key, so without one it is a
        // different request, which the API answers.
        (usePerformanceReport as Mock).mockImplementation(() =>
            useAtomValue(filterBySignpostAtom).some(Boolean)
                ? { data: undefined, error: failedWith(HttpStatusCode.BadRequest, REFUSAL) }
                : { data: undefined, error: null },
        );

        renderWith(true);

        await waitFor(() => expect(screen.getByTestId('signpost-range')).toHaveTextContent('-,-'));
        expect(screen.getByTestId('active-report')).toHaveTextContent('report-a');
        expect(createToastNotification).toHaveBeenCalledWith(
            `Signpost range removed: ${REFUSAL}`,
            'report-a',
            ToastType.WARNING,
        );
    });

    it('unloads the report on any other failure', async () => {
        const error = failedWith(HttpStatusCode.UnprocessableEntity, 'unsupported format');
        (usePerformanceReport as Mock).mockReturnValue({ data: undefined, error });

        renderWith(true);

        await waitFor(() => expect(screen.getByTestId('active-report')).toHaveTextContent('none'));
        expect(createToastNotification).toHaveBeenCalledWith(
            'Error loading report: unsupported format',
            'report-a',
            ToastType.ERROR,
        );
    });

    it('unloads the report on a bad request it sent no range with', async () => {
        const error = failedWith(HttpStatusCode.BadRequest, 'bad request');
        (usePerformanceReport as Mock).mockReturnValue({ data: undefined, error });

        renderWith(false);

        await waitFor(() => expect(screen.getByTestId('active-report')).toHaveTextContent('none'));
    });
});
