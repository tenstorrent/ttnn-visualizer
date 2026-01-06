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

// Mock DataTransfer for tests
class MockDataTransfer {
    items: DataTransferItemList & { add: (file: File) => void };

    files: FileList;

    types: readonly string[] = [];

    dropEffect: 'none' | 'copy' | 'link' | 'move' = 'none';

    effectAllowed: 'none' | 'copy' | 'copyLink' | 'copyMove' | 'link' | 'linkMove' | 'move' | 'all' | 'uninitialized' =
        'uninitialized';

    constructor() {
        const itemsList: File[] = [];
        let itemsLength = 0;
        this.items = {
            ...itemsList,
            get length() {
                return itemsLength;
            },
            add: (file: File): void => {
                itemsList.push(file);
                itemsLength = itemsList.length;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.files as any) = itemsList;
            },
            clear: (): void => {
                itemsList.length = 0;
                itemsLength = 0;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.files as any) = itemsList;
            },
            remove: (index: number): void => {
                itemsList.splice(index, 1);
                itemsLength = itemsList.length;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.files as any) = itemsList;
            },
        } as unknown as DataTransferItemList & { add: (file: File) => void };
        this.files = [] as unknown as FileList;
    }

    static setData(): void {}

    static getData(): string {
        return '';
    }

    static clearData(): void {}

    static setDragImage(): void {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).DataTransfer = MockDataTransfer;
