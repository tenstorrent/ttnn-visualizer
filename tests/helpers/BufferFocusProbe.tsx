// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { isBufferFocusedAtom, selectedBufferColourAtom } from '../../src/store/app';

/**
 * Reads "focused" while a buffer is, by the app's own rule, and "dismissed" once its highlight colour has gone too,
 * so a spec can tell whether a click dismissed all of it. That rule ignores the colour, so one left behind reads apart.
 */
export const BufferFocusProbe = () => {
    const isBufferFocused = useAtomValue(isBufferFocusedAtom);
    const selectedBufferColour = useAtomValue(selectedBufferColourAtom);

    let state = 'dismissed';
    if (isBufferFocused) {
        state = 'focused';
    } else if (selectedBufferColour !== null) {
        state = 'colour left behind';
    }

    return <output aria-label='Buffer focus'>{state}</output>;
};
