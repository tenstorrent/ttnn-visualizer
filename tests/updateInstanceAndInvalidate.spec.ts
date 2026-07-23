// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { INSTANCE_QUERY_KEY, updateInstanceAndInvalidate } from '../src/hooks/useAPI';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        put: vi.fn(),
    },
}));

describe('updateInstanceAndInvalidate', () => {
    it('updates the instance then invalidates INSTANCE_QUERY_KEY', async () => {
        const queryClient = new QueryClient();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
        const put = (await import('../src/libs/axiosInstance')).default.put as ReturnType<typeof vi.fn>;
        put.mockResolvedValue({ data: { id: 'inst-1' } });

        const result = await updateInstanceAndInvalidate(queryClient, {
            active_report: { profiler_name: 'report-a' },
        });

        expect(put).toHaveBeenCalled();
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: INSTANCE_QUERY_KEY });
        expect(result).toEqual({ id: 'inst-1' });
    });
});
