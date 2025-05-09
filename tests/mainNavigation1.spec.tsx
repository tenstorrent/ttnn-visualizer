import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from 'react-query';
import { MemoryRouter } from 'react-router';
import { Provider as JotaiProvider, PrimitiveAtom } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import { activeProfilerReportAtom } from '../src/store/app';

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

it('Main Navigation disables select options by default', async () => {
    // Mock useAPI hook BEFORE import
    vi.doMock('../src/hooks/useAPI.tsx', () => ({
        useGetClusterDescription: vi.fn(() => ({
            data: null,
        })),
    }));

    // Re-import the component AFTER mocking
    const { default: MainNavigation } = await import('../src/components/MainNavigation');

    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <TestProvider initialValues={[[activeProfilerReportAtom, null]]}>
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
    expect(buttons[5]).toBeDisabled(); // Performance
    expect(buttons[6]).toBeEnabled(); // NPE
    expect(buttons[7]).toBeDisabled(); // Topology
});
