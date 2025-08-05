// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { vi } from 'vitest';
import 'vitest-canvas-mock';

if (!window.URL) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.URL = {} as any;
}
window.URL.createObjectURL = vi.fn();

// JSDOM can't process this image from Plotly.js so we are mocking it here to avoid the warning noise in the logs
const originalSrc = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src');

Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
    set(src: string) {
        if (src === 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAAfQ//73v/+BiOh/AAA=') {
            // Simulate a successful load
            setTimeout(() => {
                if (typeof this.onload === 'function') {
                    this.onload(new Event('load'));
                }
            }, 0);
        } else if (originalSrc && originalSrc.set) {
            // Fallback to the original setter for all other images
            originalSrc.set.call(this, src);
        }
    },
    get: originalSrc?.get,
});
