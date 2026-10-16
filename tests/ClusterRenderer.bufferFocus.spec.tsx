// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClusterRenderer from '../src/components/cluster/ClusterRenderer';
import useBufferFocusDismissal from '../src/hooks/useBufferFocusDismissal';
import { selectedAddressAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import { BufferFocusProbe } from './helpers/BufferFocusProbe';
import { bufferFocus, pressAndRelease } from './helpers/bufferFocus';

vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    useGetClusterTopology: () => ({ data: undefined, isLoading: true, isError: false, error: null }),
}));

// Stands in for Operation Details or Buffer Summary, which the topology view opens over.
const PageBehind = () => {
    useBufferFocusDismissal();
    return null;
};

afterEach(cleanup);

describe('ClusterRenderer over a page holding a focused buffer (#2042)', () => {
    it('keeps that focus through a click in the topology view', () => {
        render(
            <TestProviders initialAtomValues={[[selectedAddressAtom, 0x4000]]}>
                <PageBehind />
                <ClusterRenderer />
                <BufferFocusProbe />
            </TestProviders>,
        );

        pressAndRelease(screen.getByText('Loading...'));

        expect(bufferFocus()).toHaveTextContent('focused');
    });
});
