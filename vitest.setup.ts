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
