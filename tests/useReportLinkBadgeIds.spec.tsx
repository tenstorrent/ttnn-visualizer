// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useReportLinkBadgeIds } from '../src/hooks/useReportLinkBadgeIds';
import { AtomProvider } from './helpers/atomProvider';

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => ({ REPORT_LINKING_ENABLED: false }),
}));

describe('useReportLinkBadgeIds', () => {
    it('returns null badge sets when report linking is disabled', () => {
        const { result } = renderHook(() => useReportLinkBadgeIds(), {
            wrapper: ({ children }: { children: ReactNode }) => (
                <AtomProvider initialValues={[]}>{children}</AtomProvider>
            ),
        });

        expect(result.current).toEqual({
            linkedPerfIds: null,
            unlinkedPerfIds: null,
            linkedProfilerReportIds: null,
            unlinkedProfilerReportIds: null,
        });
    });
});
