// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import { MemoryRouter } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import { ToastContainer } from 'react-toastify';
import { QueryProvider } from './queryClientProvider';
import { AtomProvider, AtomProviderInitialValues } from './atomProvider';

interface TestProvidersProps {
    initialAtomValues?: AtomProviderInitialValues;
    children: React.ReactNode;
}

export function TestProviders({ initialAtomValues = [], children }: TestProvidersProps) {
    return (
        <QueryProvider>
            <MemoryRouter>
                <HelmetProvider>
                    <AtomProvider initialValues={initialAtomValues}>
                        <>
                            {/* TODO: Look how Layout is used in app so we don't have to specifically add ToastContainer here */}
                            {children}
                            <ToastContainer
                                position='top-right'
                                autoClose={false}
                                newestOnTop={false}
                                closeOnClick
                                closeButton={false}
                                theme='light'
                            />
                        </>
                    </AtomProvider>
                </HelmetProvider>
            </MemoryRouter>
        </QueryProvider>
    );
}
