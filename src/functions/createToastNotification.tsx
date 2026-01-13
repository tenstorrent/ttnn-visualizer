// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ToastOptions, toast } from 'react-toastify';
import ToastFileChange from '../components/ToastFileChange';

export enum ToastType {
    INFO = 'info',
    SUCCESS = 'success',
    WARNING = 'warning',
    ERROR = 'error',
}

export default function createToastNotification(message: string, fileName: string, type?: ToastType) {
    const template = (
        <ToastFileChange
            message={message}
            fileName={fileName}
        />
    );

    // prevent duplicate toasts by setting an id
    const toastId = `${message}-${fileName}`;

    const args: ToastOptions = {
        toastId,
    };

    if (toast.isActive(toastId)) {
        return;
    }

    if (type) {
        toast[type](template, args);
    } else {
        toast(template, args);
    }
}
