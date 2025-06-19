// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Mock, afterEach, expect, it, vi } from 'vitest';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../src/store/app';
import { useGetClusterDescription } from '../src/hooks/useAPI';
import clusterDescription from './data/clusterDescription.json';
import MainNavigation from '../src/components/MainNavigation';
import getButtonWithText from './helpers/getButtonWithText';
import { TestProviders } from './helpers/TestProviders';

// Scrub the markup after each test
afterEach(cleanup);

// Mark the useGetClusterDescription as a mock function
vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetClusterDescription: vi.fn(),
}));

it('Main Navigation disables specific options by default', () => {
    // Specify the return of the mocked function in this test
    (useGetClusterDescription as Mock).mockReturnValue({ data: null });

    render(
        <TestProviders initialAtomValues={[[activeProfilerReportAtom, null]]}>
            <MainNavigation />
        </TestProviders>,
    );

    expect(getButtonWithText('reports')).toBeEnabled();
    expect(getButtonWithText('operations')).toBeDisabled();
    expect(getButtonWithText('tensors')).toBeDisabled();
    expect(getButtonWithText('buffers')).toBeDisabled();
    expect(getButtonWithText('graph')).toBeDisabled();
    expect(getButtonWithText('performance')).toBeDisabled();
    expect(getButtonWithText('npe')).toBeEnabled();
    expect(getButtonWithText('topology')).toBeDisabled();
});

it('Main Navigation enables specific options when there is an active memory report', () => {
    (useGetClusterDescription as Mock).mockReturnValue({ data: clusterDescription });

    render(
        <TestProviders initialAtomValues={[[activeProfilerReportAtom, 'test']]}>
            <MainNavigation />
        </TestProviders>,
    );

    expect(getButtonWithText('reports')).toBeEnabled();
    expect(getButtonWithText('operations')).toBeEnabled();
    expect(getButtonWithText('tensors')).toBeEnabled();
    expect(getButtonWithText('buffers')).toBeEnabled();
    expect(getButtonWithText('graph')).toBeEnabled();
    expect(getButtonWithText('performance')).toBeDisabled();
    expect(getButtonWithText('npe')).toBeEnabled();
    expect(getButtonWithText('topology')).toBeEnabled();
});

it('Main Navigation enables specific options when there is an active performance report', () => {
    (useGetClusterDescription as Mock).mockReturnValue({ data: null });

    render(
        <TestProviders initialAtomValues={[[activePerformanceReportAtom, 'test']]}>
            <MainNavigation />
        </TestProviders>,
    );

    expect(getButtonWithText('reports')).toBeEnabled();
    expect(getButtonWithText('operations')).toBeDisabled();
    expect(getButtonWithText('tensors')).toBeDisabled();
    expect(getButtonWithText('buffers')).toBeDisabled();
    expect(getButtonWithText('graph')).toBeDisabled();
    expect(getButtonWithText('performance')).toBeEnabled();
    expect(getButtonWithText('npe')).toBeEnabled();
    expect(getButtonWithText('topology')).toBeDisabled();
});
