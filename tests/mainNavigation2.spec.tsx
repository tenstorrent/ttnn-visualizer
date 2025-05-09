import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { activeProfilerReportAtom } from '../src/store/app';
import clusterDesc from './data/clusterDescription.json';
import { AtomProvider } from './helpers/atomProvider';
import { QueryProvider } from './helpers/queryClientProvider';

afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.clearAllMocks();
});

it('Main Navigation enables specific options when there is an active memory report', async () => {
    vi.doMock('../src/hooks/useAPI.tsx', () => ({
        useGetClusterDescription: vi.fn(() => ({
            data: clusterDesc,
        })),
    }));

    const { default: MainNavigation } = await import('../src/components/MainNavigation');

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
