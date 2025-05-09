import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from 'react-query';
import { MemoryRouter } from 'react-router';
import { Provider as JotaiProvider, PrimitiveAtom } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import { activePerformanceReportAtom } from '../src/store/app';

const queryClient = new QueryClient();

const HydrateAtoms = ({
    initialValues,
    children,
}: {
    initialValues: [PrimitiveAtom<string | null>, string | null][];
    children: React.ReactNode;
}) => {
    useHydrateAtoms(initialValues);
    return children;
};

const TestProvider = ({
    initialValues,
    children,
}: {
    initialValues: [PrimitiveAtom<string | null>, string | null][];
    children: React.ReactNode;
}) => (
    <JotaiProvider>
        <HydrateAtoms initialValues={initialValues}>{children}</HydrateAtoms>
    </JotaiProvider>
);

afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.clearAllMocks();
});

it('Main Navigation enables select options when there is an active profiler report', async () => {
    vi.doMock('../src/hooks/useAPI.tsx', () => ({
        useGetClusterDescription: vi.fn(() => ({
            data: null,
        })),
    }));

    const { default: MainNavigation } = await import('../src/components/MainNavigation');

    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <TestProvider initialValues={[[activePerformanceReportAtom, 'test']]}>
                    <MainNavigation />
                </TestProvider>
            </MemoryRouter>
        </QueryClientProvider>,
    );

    const buttons = screen.getAllByRole('button');

    expect(buttons[0]).toBeEnabled(); // Reports
    expect(buttons[1]).toBeDisabled(); // Operations
    expect(buttons[2]).toBeDisabled(); // Tensors
    expect(buttons[3]).toBeDisabled(); // Buffers
    expect(buttons[4]).toBeDisabled(); // Graph
    expect(buttons[5]).toBeEnabled(); // Performance
    expect(buttons[6]).toBeEnabled(); // NPE
    expect(buttons[7]).toBeDisabled(); // Topology
});
