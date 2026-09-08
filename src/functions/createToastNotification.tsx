// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Id, ToastContent, ToastOptions, toast } from 'react-toastify';
import ToastFileChange from '../components/ToastFileChange';
import { ToastType } from '../definitions/ToastType';

// Everything below is the only code allowed to call `react-toastify`'s `toast`, so every
// toast in the app shares the single `<ToastContainer>` mounted in `Layout.tsx`. Defaults
// belong on that container -- `options` is for a toast's departures from them, such as the
// `autoClose: false` a toast that must survive until dismissed needs.
export function createToast(content: ToastContent, options?: ToastOptions, type?: ToastType): Id {
    return type ? toast[type](content, options) : toast(content, options);
}

// Omitting `toastId` dismisses every open toast, matching `toast.dismiss()`.
export function dismissToast(toastId?: Id) {
    toast.dismiss(toastId);
}

export default function createToastNotification(message: string, fileName: string, type?: ToastType): Id {
    const template = (
        <ToastFileChange
            message={message}
            fileName={fileName}
        />
    );

    return createToast(template, undefined, type);
}
