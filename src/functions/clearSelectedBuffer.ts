// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useEffect } from 'react';
import useBufferFocus from '../hooks/useBufferFocus';

function useClearSelectedBuffer() {
    const { resetToasts } = useBufferFocus();

    useEffect(() => {
        resetToasts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}

export default useClearSelectedBuffer;
