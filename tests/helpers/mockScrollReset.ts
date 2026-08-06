// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { vi } from 'vitest';

/**
 * Stubs the scroll reset `useShowPerfTable` performs when a chart hands the table a filter.
 * jsdom implements neither call, so any suite exercising that path needs both.
 */
export function setUpScrollResetMocks() {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        callback(0);
        return 0;
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
}
