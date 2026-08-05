// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FooterInfobar from '../src/components/FooterInfobar';
import { activeProfilerReportAtom } from '../src/store/app';
import mockInstance from './data/mockInstance.json';
import { MOCK_FULL_GIT_SHA, MOCK_HTTP_GIT_URL, MOCK_SHORT_GIT_SHA } from './helpers/gitFixtures';
import { TestProviders } from './helpers/TestProviders';

const mockUseReportMetadata = vi.fn();
const mockUseInstance = vi.fn();
const mockUseGetLatestAppVersion = vi.fn();

vi.mock('../src/components/RangeSlider', () => ({
    default: () => null,
}));

vi.mock('../src/hooks/useAPI.tsx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/hooks/useAPI.tsx')>();
    return {
        ...actual,
        useReportMetadata: () => mockUseReportMetadata(),
        useInstance: () => mockUseInstance(),
        useGetLatestAppVersion: () => mockUseGetLatestAppVersion(),
    };
});

vi.mock('../src/functions/getServerConfig.ts', () => ({
    default: () => ({
        SERVER_MODE: false,
        BASE_PATH: '/',
        REPORT_DATA_DIRECTORY: '/data/reports',
    }),
}));

vi.mock('@blueprintjs/core', async () => {
    const original = await vi.importActual<typeof import('@blueprintjs/core')>('@blueprintjs/core');
    return {
        ...original,
        Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
            <div data-testid='tooltip-host'>
                <div data-testid='tooltip-content'>{content}</div>
                {children}
            </div>
        ),
    };
});

const REPORT_PATH = '/reports/memory/my-report';

const renderFooter = (
    reportMetadata: { gitUrl?: string | null; gitSha?: string | null; worldSize?: number } | undefined,
) => {
    mockUseReportMetadata.mockReturnValue({ data: reportMetadata });
    mockUseInstance.mockReturnValue({ data: mockInstance });
    mockUseGetLatestAppVersion.mockReturnValue({
        data: '1.0.0',
        isPending: false,
        isError: false,
    });

    return render(
        <TestProviders
            initialAtomValues={[
                [
                    activeProfilerReportAtom,
                    {
                        reportName: 'my-report',
                        path: REPORT_PATH,
                    },
                ],
            ]}
        >
            <FooterInfobar />
        </TestProviders>,
    );
};

const getMemoryReportTooltipContent = (): HTMLElement => {
    const tooltips = screen.getAllByTestId('tooltip-content');
    const memoryTooltip = tooltips.find((tooltip) => within(tooltip).queryByText(/Report path:/));

    expect(memoryTooltip).toBeDefined();

    return memoryTooltip as HTMLElement;
};

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(cleanup);

describe('FooterInfobar memory report tooltip', () => {
    it('subscribes to report metadata when a profiler report is active', () => {
        renderFooter(undefined);

        expect(mockUseReportMetadata).toHaveBeenCalled();
    });

    it('shows only the report path when git metadata is absent', () => {
        renderFooter(undefined);

        const tooltip = getMemoryReportTooltipContent();
        expect(tooltip.textContent).toContain('Report path:');
        expect(tooltip.textContent).toContain('/my-report');
        expect(tooltip.textContent).not.toMatch(/Git repo:/);
        expect(tooltip.textContent).not.toMatch(/Commit:/);
    });

    it('shows git repo and a commit link when both are present with an HTTP remote', () => {
        renderFooter({ gitUrl: MOCK_HTTP_GIT_URL, gitSha: MOCK_FULL_GIT_SHA });

        const tooltip = getMemoryReportTooltipContent();
        expect(tooltip.textContent).toContain(`Git repo: ${MOCK_HTTP_GIT_URL}`);
        expect(tooltip.textContent).toContain(`Commit: ${MOCK_SHORT_GIT_SHA}`);

        const link = within(tooltip).getByRole('link');
        expect(link).toHaveAttribute('href', `https://github.com/foo/bar/commit/${MOCK_FULL_GIT_SHA}`);
    });
});

// The API scopes report reads to rank 0, so a multi-host report shows one rank's
// data. Without this notice the run looks complete rather than partial. #1842
describe('FooterInfobar multi-host rank scoping', () => {
    it('announces the scoped rank when the report spans several ranks', () => {
        renderFooter({ worldSize: 2 });

        expect(screen.getByLabelText('Showing rank 0 of 2')).toBeInTheDocument();
        expect(getMemoryReportTooltipContent().textContent).toContain('showing rank 0 of 2');
    });

    it.each([
        ['single-rank', 1],
        ['unreported', undefined],
    ])('stays silent on a %s report', (_label, worldSize) => {
        renderFooter({ worldSize });

        expect(screen.queryByLabelText(/Showing rank/)).not.toBeInTheDocument();
        expect(getMemoryReportTooltipContent().textContent).not.toMatch(/showing rank/);
    });
});
