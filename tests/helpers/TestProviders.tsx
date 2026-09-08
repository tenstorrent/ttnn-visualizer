// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import { InitialEntry, MemoryRouter } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import { Theme, ToastContainer, ToastPosition } from 'react-toastify';
import { QueryProvider } from './queryClientProvider';
import { AtomProvider, AtomProviderInitialValues } from './atomProvider';

interface TestProvidersProps {
    initialAtomValues?: AtomProviderInitialValues;
    // Lets a spec place the router somewhere other than `/`, which anything asserting on
    // the active route -- or on a modal's background location -- needs to do.
    initialEntries?: InitialEntry[];
    children: React.ReactNode;
}

export function TestProviders({ initialAtomValues = [], initialEntries, children }: TestProvidersProps) {
    return (
        <QueryProvider>
            <MemoryRouter initialEntries={initialEntries}>
                <HelmetProvider>
                    <AtomProvider initialValues={initialAtomValues}>
                        <>
                            {/* TODO: Look how Layout is used in app so we don't have to specifically add ToastContainer here */}
                            {children}
                            <ToastContainer
                                position={'bottom-right' as ToastPosition}
                                autoClose={false}
                                newestOnTop={false}
                                closeOnClick
                                closeButton={false}
                                theme={'light' as Theme}
                            />
                        </>
                    </AtomProvider>
                </HelmetProvider>
            </MemoryRouter>
        </QueryProvider>
    );
}
