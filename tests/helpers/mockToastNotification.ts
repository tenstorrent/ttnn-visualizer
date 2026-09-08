// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Mock, vi } from 'vitest';

// `vi.mock('.../createToastNotification', () => toastNotificationModuleMock())` -- one shape
// for every spec that only wants toasts neutralised. Supplying the whole module matters:
// a factory that returns `default` alone leaves `createToast`/`dismissToast` undefined, so
// any component that later reaches the persistent-toast path fails as "not a function"
// rather than as the assertion the spec was written for.
export function toastNotificationModuleMock(createToastNotification: Mock = vi.fn()) {
    return {
        default: createToastNotification,
        createToast: vi.fn(() => 'mock-toast-id'),
        dismissToast: vi.fn(),
    };
}
