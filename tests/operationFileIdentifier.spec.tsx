// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * `operationFileIdentifier` reaches the operations list and operation details only through
 * `fetchOperations` and `fetchOperationDetails`. Component specs build it by hand, so only this
 * spec sees the label come from a real trace through the real queries. #2367
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOperationDetails, useOperationsList } from '../src/hooks/useAPI';
import { activeProfilerReportAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { defaultOperation } from '../src/model/APIData';
import { makeOperation } from './helpers/operationDescription';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const OPERATION_ID = 5;
const CALL_SITE_TRACE = '  File "/m/models/resnet.py", line 135, in run\n    ttnn.conv2d(x)';
// The code line quotes a frame; the old unanchored regex labelled it `quoted.py:3`.
const QUOTED_FRAME_TRACE = `    raise ValueError('File "/m/quoted.py", line 3, in f')\n  File "/m/real.py", line 7, in fn`;

const mockResponses = (listStackTrace: string, detailsStackTrace: string | null) => {
    vi.mocked(axiosInstance.get).mockImplementation((url) => {
        if (String(url) === Endpoints.OPERATIONS_LIST) {
            return Promise.resolve({ data: [makeOperation({ id: OPERATION_ID, stack_trace: listStackTrace })] });
        }

        if (String(url) === `${Endpoints.OPERATIONS_LIST}/${OPERATION_ID}`) {
            return Promise.resolve({
                data: { ...defaultOperation, id: OPERATION_ID, stack_trace: detailsStackTrace },
            });
        }

        return Promise.resolve({ data: [] });
    });
};

const renderWithProviders = <T,>(hook: () => T) => {
    const store = createStore();
    store.set(activeProfilerReportAtom, { path: 'testPath', reportName: 'test' });
    const queryClient = new QueryClient();

    return renderHook(hook, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(cleanup);

describe('useOperationsList operationFileIdentifier', () => {
    it.each([
        ['the call site', CALL_SITE_TRACE, 'resnet.py:135'],
        ['the real frame after a quoted one', QUOTED_FRAME_TRACE, 'real.py:7'],
    ])('labels %s', async (_case, stackTrace, expected) => {
        mockResponses(stackTrace, null);
        const { result } = renderWithProviders(() => useOperationsList());

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(result.current.data?.[0].operationFileIdentifier).toBe(expected);
    });
});

describe('useOperationDetails operationFileIdentifier', () => {
    it("labels the details response's call site", async () => {
        mockResponses('', CALL_SITE_TRACE);
        const { result } = renderWithProviders(() => useOperationDetails(OPERATION_ID));

        await waitFor(() => expect(result.current.operationDetails.isSuccess).toBe(true));

        expect(result.current.operationDetails.data?.operationFileIdentifier).toBe('resnet.py:135');
    });

    it('is empty when the endpoint sends no trace', async () => {
        mockResponses('', null);
        const { result } = renderWithProviders(() => useOperationDetails(OPERATION_ID));

        await waitFor(() => expect(result.current.operationDetails.isSuccess).toBe(true));

        expect(result.current.operationDetails.data?.operationFileIdentifier).toBe('');
    });
});
