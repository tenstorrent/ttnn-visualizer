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
const ORIGINAL_SRC = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src');

// This is the base64-encoded WebP image data used by Plotly.js for feature detection.
// See: https://github.com/plotly/mapbox-gl-js/blob/master/src/util/webp_supported.js
const PLOTLY_WEBP_TEST_IMAGE_SRC = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAAfQ//73v/+BiOh/AAA=';

Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
    set(src: string) {
        if (src === PLOTLY_WEBP_TEST_IMAGE_SRC) {
            setTimeout(() => {
                if (typeof this.onload === 'function') {
                    this.onload(new Event('load'));
                }
            }, 0);
        } else if (ORIGINAL_SRC?.set) {
            ORIGINAL_SRC.set.call(this, src);
        }
    },
    get: ORIGINAL_SRC?.get,
});
