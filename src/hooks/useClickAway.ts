// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect } from 'react';
import isClickAway from '../functions/isClickAway';

/** Calls `onClickAway`, which must be stable, for each click on nothing that handles it while `isEnabled`. */
export default function useClickAway(isEnabled: boolean, onClickAway: () => void): void {
    useEffect(() => {
        if (!isEnabled) {
            return undefined;
        }
        const handleClick = (event: MouseEvent) => {
            if (isClickAway(event)) {
                onClickAway();
            }
        };
        // Captured, so the click is judged before any handler can re-render what it landed on.
        document.addEventListener('click', handleClick, true);
        return () => document.removeEventListener('click', handleClick, true);
    }, [isEnabled, onClickAway]);
}
