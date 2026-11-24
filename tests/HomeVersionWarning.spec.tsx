// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Home mounts the local and the remote report selectors together. Each used to own a copy of
 * the DB version check, so an incompatible report raised the same warning twice. The check
 * now lives once, on Home.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Home from '../src/routes/Home';
import { ToastType } from '../src/definitions/ToastType';
import { TARGET_DB_VERSION_MAX } from '../src/definitions/Versions';
import createToastNotification from '../src/functions/createToastNotification';
import { INCOMPATIBLE_REPORT_VERSION_TOAST_TITLE } from '../src/hooks/useDbVersionWarning';
import { activeProfilerReportAtom } from '../src/store/app';
import mockInstance from './data/mockInstance.json';
import mockPerformanceReportFolders from './data/mockPerformanceReportFolders.json';
import mockProfilerFolderList from './data/mockProfilerFolderList.json';
import { TestProviders } from './helpers/TestProviders';

const reportMetadata = vi.hoisted(() => ({ version: { major: 0, minor: 0, patch: 0 } }));

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetClusterDescription: () => ({ data: null }),
    usePerfFolderList: () => ({ data: mockPerformanceReportFolders }),
    useInstance: () => ({ data: mockInstance }),
    useReportFolderList: () => ({ data: mockProfilerFolderList }),
    useReportMetadata: () => ({ data: reportMetadata, error: undefined }),
    useActiveReportFingerprints: () => ({ data: undefined, isPending: true }),
}));

vi.mock('../src/functions/createToastNotification', () => ({ default: vi.fn() }));

afterEach(cleanup);

beforeEach(() => {
    vi.mocked(createToastNotification).mockClear();
});

const renderHome = () =>
    render(
        <TestProviders initialAtomValues={[[activeProfilerReportAtom, mockProfilerFolderList[0]]]}>
            <Home />
        </TestProviders>,
    );

const versionWarnings = () =>
    vi
        .mocked(createToastNotification)
        .mock.calls.filter(([title]) => title === INCOMPATIBLE_REPORT_VERSION_TOAST_TITLE);

it('warns once about an incompatible report version with both selectors mounted', async () => {
    reportMetadata.version = { major: TARGET_DB_VERSION_MAX + 1, minor: 0, patch: 0 };

    renderHome();

    await waitFor(() => expect(versionWarnings()).toHaveLength(1));
    expect(versionWarnings()[0][1]).toContain(`v${TARGET_DB_VERSION_MAX + 1}.0.0`);
    expect(versionWarnings()[0][2]).toBe(ToastType.WARNING);
});

it('does not warn about a supported report version', async () => {
    reportMetadata.version = { major: TARGET_DB_VERSION_MAX, minor: 0, patch: 0 };

    renderHome();

    // Flush the effects before asserting nothing was raised
    await act(async () => {});

    expect(versionWarnings()).toHaveLength(0);
});
