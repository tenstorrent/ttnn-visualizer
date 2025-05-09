import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Mock, afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../src/store/app';
import { AtomProvider } from './helpers/atomProvider';
import { QueryProvider } from './helpers/queryClientProvider';
import { useGetClusterDescription } from '../src/hooks/useAPI';
import clusterDescription from './data/clusterDescription.json';
import MainNavigation from '../src/components/MainNavigation';

afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.clearAllMocks();
});

// Mark the useGetClusterDescription as a mock function
vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetClusterDescription: vi.fn(),
}));

it('Main Navigation disables specific options by default', () => {
    // Specify the return of the mocked function in this test
    (useGetClusterDescription as Mock).mockReturnValue({ data: null });

    render(
        <QueryProvider>
            <MemoryRouter>
                <AtomProvider initialValues={[[activeProfilerReportAtom, null]]}>
                    <MainNavigation />
                </AtomProvider>
            </MemoryRouter>
        </QueryProvider>,
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

it('Main Navigation enables specific options when there is an active memory report', () => {
    (useGetClusterDescription as Mock).mockReturnValue({ data: clusterDescription });

    render(
        <QueryProvider>
            <MemoryRouter>
                <AtomProvider initialValues={[[activeProfilerReportAtom, 'test']]}>
                    <MainNavigation />
                </AtomProvider>
            </MemoryRouter>
        </QueryProvider>,
    );

    const buttons = screen.getAllByRole('button');

    expect(buttons[0]).toBeEnabled(); // Reports
    expect(buttons[1]).toBeEnabled(); // Operations
    expect(buttons[2]).toBeEnabled(); // Tensors
    expect(buttons[3]).toBeEnabled(); // Buffers
    expect(buttons[4]).toBeEnabled(); // Graph
    expect(buttons[5]).toBeDisabled(); // Performance
    expect(buttons[6]).toBeEnabled(); // NPE
    expect(buttons[7]).toBeEnabled(); // Topology
});

it('Main Navigation enables specific options when there is an active performance report', () => {
    (useGetClusterDescription as Mock).mockReturnValue({ data: null });

    render(
        <QueryProvider>
            <MemoryRouter>
                <AtomProvider initialValues={[[activePerformanceReportAtom, 'test']]}>
                    <MainNavigation />
                </AtomProvider>
            </MemoryRouter>
        </QueryProvider>,
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
