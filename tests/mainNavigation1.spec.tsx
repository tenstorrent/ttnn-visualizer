import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { activeProfilerReportAtom } from '../src/store/app';
import { AtomProvider } from './helpers/atomProvider';
import { QueryProvider } from './helpers/queryClientProvider';

afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.clearAllMocks();
});

it('Main Navigation disables specific options by default', async () => {
    // Mock useAPI hook BEFORE import
    vi.doMock('../src/hooks/useAPI.tsx', () => ({
        useGetClusterDescription: vi.fn(() => ({
            data: null,
        })),
    }));

    // Re-import the component AFTER mocking
    const { default: MainNavigation } = await import('../src/components/MainNavigation');

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
