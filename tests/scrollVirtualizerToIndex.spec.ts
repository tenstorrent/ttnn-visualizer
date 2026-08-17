// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it, vi } from 'vitest';
import { scrollVirtualizerToIndex } from '../src/functions/scrollVirtualizerToIndex';

describe('scrollVirtualizerToIndex', () => {
    it('calls scrollToIndex twice with the same index and align', () => {
        const scrollToIndex = vi.fn();

        scrollVirtualizerToIndex({ scrollToIndex }, 7, { align: 'center' });

        expect(scrollToIndex).toHaveBeenCalledTimes(2);
        expect(scrollToIndex).toHaveBeenNthCalledWith(1, 7, { align: 'center' });
        expect(scrollToIndex).toHaveBeenNthCalledWith(2, 7, { align: 'center' });
    });

    it('defaults align to start', () => {
        const scrollToIndex = vi.fn();

        scrollVirtualizerToIndex({ scrollToIndex }, 3);

        expect(scrollToIndex).toHaveBeenCalledWith(3, { align: 'start' });
    });
});
