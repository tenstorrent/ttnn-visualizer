// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import { Provider } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import type { WritableAtom } from 'jotai';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AtomProviderInitialValues = Array<[WritableAtom<unknown, any[], unknown>, unknown]>;

export const HydrateAtoms = ({
    initialValues,
    children,
}: {
    initialValues: AtomProviderInitialValues;
    children: React.ReactNode;
}) => {
    useHydrateAtoms(initialValues);
    return children;
};

export const AtomProvider = ({
    initialValues,
    children,
}: {
    initialValues: AtomProviderInitialValues;
    children: React.ReactNode;
}) => (
    <Provider>
        <HydrateAtoms initialValues={initialValues}>{children}</HydrateAtoms>
    </Provider>
);
