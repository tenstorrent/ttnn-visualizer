// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cssTransition } from 'react-toastify';

// `display: none` on the exit class hid the toast but skipped `animationend`, so
// react-toastify never called `done()` and the node stayed mounted. #2044
export const TOAST_TRANSITION: Parameters<typeof cssTransition>[0] = {
    enter: 'Toastify--animate Toastify__bounce-enter',
    exit: 'toast-exit-immediate Toastify__bounce-exit',
    appendPosition: true,
    collapse: false,
};

export const BounceIn = cssTransition(TOAST_TRANSITION);
