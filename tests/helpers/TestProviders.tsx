import React from 'react';
import { MemoryRouter } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import { PrimitiveAtom } from 'jotai';
import { QueryProvider } from './queryClientProvider';
import { AtomProvider } from './atomProvider';

interface TestProvidersProps {
    initialAtomValues?: [PrimitiveAtom<string | null>, string | null][];
    children: React.ReactNode;
}

export function TestProviders({ initialAtomValues = [], children }: TestProvidersProps) {
    return (
        <QueryProvider>
            <MemoryRouter>
                <HelmetProvider>
                    <AtomProvider initialValues={initialAtomValues}>{children}</AtomProvider>
                </HelmetProvider>
            </MemoryRouter>
        </QueryProvider>
    );
}
