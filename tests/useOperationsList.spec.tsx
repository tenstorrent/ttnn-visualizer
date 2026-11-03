// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * `fetchOperations` decides which arguments the operation details view renders as a memory config
 * table. `TensorArgument.spec.tsx` builds its arguments the same way by hand, so only this spec
 * sees the parsing come from the real query. #2107
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOperationsList } from '../src/hooks/useAPI';
import { activeProfilerReportAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import parseMemoryConfig from '../src/functions/parseMemoryConfig';
import { OperationDescription } from '../src/model/APIData';
import { makeMemoryConfigArgument, makeOperation, makeTensorRepr } from './helpers/operationDescription';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const ACTIVE_REPORT = { path: 'testPath', reportName: 'test' };
const MEMORY_CONFIG = makeMemoryConfigArgument('L1').value;

// As the backend sends them: no `parsedValue` yet, hence the cast.
const RAW_ARGUMENTS = [
    { name: 'memory_config', value: MEMORY_CONFIG },
    { name: 'memory_config', value: makeTensorRepr(MEMORY_CONFIG) },
    { name: '1', value: '1, -1, 144' },
] as OperationDescription['arguments'];

const renderOperationsList = () => {
    const store = createStore();
    store.set(activeProfilerReportAtom, ACTIVE_REPORT);
    const queryClient = new QueryClient();

    return renderHook(() => useOperationsList(), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axiosInstance.get).mockImplementation((url) =>
        Promise.resolve({
            data:
                String(url) === Endpoints.OPERATIONS_LIST
                    ? [makeOperation({ stack_trace: '', arguments: RAW_ARGUMENTS })]
                    : [],
        }),
    );
});

afterEach(cleanup);

describe('useOperationsList', () => {
    it('parses only the arguments whose whole value is a memory config', async () => {
        const { result } = renderOperationsList();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(result.current.data?.[0].arguments.map(({ parsedValue }) => parsedValue)).toEqual([
            parseMemoryConfig(MEMORY_CONFIG),
            null,
            null,
        ]);
    });
});
