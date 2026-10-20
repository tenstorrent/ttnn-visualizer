// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect } from 'react';
import { useResetBufferFocus } from './useBufferFocus';

function useClearSelectedBuffer() {
    const resetBufferFocus = useResetBufferFocus();

    useEffect(() => {
        resetBufferFocus();
    }, [resetBufferFocus]);
}

export default useClearSelectedBuffer;
