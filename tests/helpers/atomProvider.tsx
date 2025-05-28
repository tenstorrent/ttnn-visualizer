// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from 'react';
import { PrimitiveAtom, Provider } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';

export const HydrateAtoms = ({
    initialValues,
    children,
}: {
    initialValues: [PrimitiveAtom<string | null>, string | null][];
    children: React.ReactNode;
}) => {
    useHydrateAtoms(initialValues);
    return children;
};

export const AtomProvider = ({
    initialValues,
    children,
}: {
    initialValues: [PrimitiveAtom<string | null>, string | null][];
    children: React.ReactNode;
}) => (
    <Provider>
        <HydrateAtoms initialValues={initialValues}>{children}</HydrateAtoms>
    </Provider>
);
