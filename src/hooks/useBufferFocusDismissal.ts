// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { useResetBufferFocus } from './useBufferFocus';
import { isBufferFocusedAtom } from '../store/app';
import { isBufferFocusDismissal, isEndOfTextSelection } from '../functions/bufferFocusDismissal';

/**
 * Dismisses the focused buffer on a click pressed and released on nothing that handles it. A drag from
 * content onto a control counts: the browser sends that click to their common ancestor. #2042
 */
export default function useBufferFocusDismissal(): void {
    const isBufferFocused = useAtomValue(isBufferFocusedAtom);
    const resetBufferFocus = useResetBufferFocus();

    useEffect(() => {
        if (!isBufferFocused) {
            return undefined;
        }
        // The press counts too: a press on a control released elsewhere is not a click away, and a
        // plot's drag cover can retarget the release outside the plot.
        let wasPressedAway = false;
        const handlePointerDown = (event: PointerEvent) => {
            wasPressedAway = isBufferFocusDismissal(event.target);
        };
        const handleClick = (event: MouseEvent) => {
            const { target } = event;
            const isDismissal = wasPressedAway && isBufferFocusDismissal(target) && !isEndOfTextSelection(target);
            wasPressedAway = false;
            if (isDismissal) {
                resetBufferFocus();
            }
        };
        // Captured, so each is judged before a handler can re-render what it landed on.
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('click', handleClick, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('click', handleClick, true);
        };
    }, [isBufferFocused, resetBufferFocus]);
}
