// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import {
    activeToastAtom,
    isBufferFocusedAtom,
    selectedAddressAtom,
    selectedBufferColourAtom,
    selectedTensorIdAtom,
} from '../src/store/app';
import type { AtomProviderInitialValues } from './helpers/atomProvider';

const storeWith = (values: AtomProviderInitialValues) => {
    const store = createStore();
    values.forEach(([atom, value]) => store.set(atom, value));

    return store;
};

describe('isBufferFocusedAtom', () => {
    it.each<[string, AtomProviderInitialValues]>([
        ['a buffer at address 0', [[selectedAddressAtom, 0]]],
        ['a tensor with no address', [[selectedTensorIdAtom, 10]]],
        ['only a toast', [[activeToastAtom, 'buffer-toast']]],
    ])('holds a focus with %s', (_, values) => {
        expect(storeWith(values).get(isBufferFocusedAtom)).toBe(true);
    });

    it.each<[string, AtomProviderInitialValues]>([
        ['nothing set', []],
        ['only a highlight colour', [[selectedBufferColourAtom, '#4e79a7']]],
        ['an address that is not a number', [[selectedAddressAtom, Number.NaN]]],
    ])('holds none with %s', (_, values) => {
        expect(storeWith(values).get(isBufferFocusedAtom)).toBe(false);
    });
});
