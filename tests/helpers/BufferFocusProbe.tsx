// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { activeToastAtom, selectedAddressAtom, selectedTensorIdAtom } from '../../src/store/app';

/** Reads "focused" while any of the buffer focus atoms is set, so a spec can tell whether a click dismissed it. */
export const BufferFocusProbe = () => {
    const toast = useAtomValue(activeToastAtom);
    const address = useAtomValue(selectedAddressAtom);
    const tensorId = useAtomValue(selectedTensorIdAtom);
    const isFocused = toast !== null || address !== null || tensorId !== null;
    return <output aria-label='Buffer focus'>{isFocused ? 'focused' : 'dismissed'}</output>;
};
